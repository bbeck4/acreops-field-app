import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createSampleLabResult,
  getGetSamplingPlanQueryKey,
  getListSamplingPlansQueryKey,
  getGetSampleQrCodeByCodeQueryKey,
  getLookupSampleByCodeQueryKey,
  transitionSample,
  updateSample,
  useGetSampleQrCodeByCode,
  useGetSamplingPlan,
  useLookupSampleByCode,
  type SampleLookup,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { haversineKm } from "@/components/NearbyTray";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import { pickNextSample } from "@/lib/sampling";

// A pull more than this far from the planned point prompts the rep to re-home the
// point to where the sample was actually taken (requirement: >10 ft override).
const POINT_MOVE_THRESHOLD_FT = 10;
const KM_TO_FT = 3280.84;

type PickedPhoto = {
  uri: string;
  contentType: string;
  filename: string;
};

const STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  collected: "Collected",
  shipped: "Shipped",
  at_lab: "At Lab",
  results_received: "Results Received",
};

function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABELS[status] ?? status;
}

export default function SampleCollectScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string; from?: string }>();
  const code = (params.code ?? "").trim();
  const guided = params.from === "guided";
  const { getToken } = useAuth();
  const { isOnline, queueWrite, triggerFlush } = useOffline();
  const queryClient = useQueryClient();

  const {
    data: sample,
    isLoading,
    isError,
    error,
  } = useLookupSampleByCode(code, {
    query: {
      enabled: code.length > 0,
      retry: false,
      queryKey: getLookupSampleByCodeQueryKey(code),
    },
  });

  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [capturingGps, setCapturingGps] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [movingPoint, setMovingPoint] = useState(false);
  const [pointMoved, setPointMoved] = useState(false);
  // Guided one-tap flow: once a point is saved we show a success panel with a
  // "Next point" jump instead of bouncing back to the map every time.
  const [collected, setCollected] = useState(false);
  // Points collected during this guided run, so the next-point suggestion never
  // loops back to one we just did — critical offline, where the cached plan can't
  // refresh to reflect the new status.
  const collectedIdsRef = useRef<Set<number>>(new Set());

  // The guided plan, loaded only to compute the next uncollected point in the
  // one-tap flow. Online collects invalidate this key so it refetches fresh.
  const { data: plan } = useGetSamplingPlan(sample?.planId ?? 0, {
    query: {
      enabled: guided && !!sample?.planId,
      queryKey: getGetSamplingPlanQueryKey(sample?.planId ?? 0),
    },
  });

  // Reset per-point inputs whenever the bag code changes. router.replace into the
  // next point reuses this same screen instance, so without this the previous
  // point's photo / GPS / notes / success state would carry over.
  useEffect(() => {
    setNotes("");
    setPhoto(null);
    setCoords(null);
    setPointMoved(false);
    setCollected(false);
  }, [code]);

  // Distance (ft) between the captured pull location and the planned point, when both
  // are known. Drives the ">10 ft — update the point?" prompt.
  const distanceFromPlannedFt = useMemo(() => {
    if (!coords || !sample) return null;
    if (typeof sample.latitude !== "number" || typeof sample.longitude !== "number") return null;
    return (
      haversineKm(
        { lat: coords.latitude, lng: coords.longitude },
        { lat: sample.latitude, lng: sample.longitude },
      ) * KM_TO_FT
    );
  }, [coords, sample]);

  const farFromPlanned =
    !pointMoved && distanceFromPlannedFt != null && distanceFromPlannedFt > POINT_MOVE_THRESHOLD_FT;

  // Next uncollected point for the one-tap flow: nearest to where we're standing
  // (the just-captured GPS), preferring the active point's zone, skipping any we
  // already collected this run. `collected` is a dep so it recomputes once saved.
  const nextSample = useMemo(() => {
    if (!guided || !sample) return null;
    return pickNextSample(plan?.samples ?? [], {
      origin: coords,
      preferZoneId: sample.zoneId ?? null,
      excludeIds: collectedIdsRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guided, sample, plan?.samples, coords, collected]);
  const nextZoneName = useMemo(() => {
    if (!nextSample?.zoneId) return null;
    return plan?.zones?.find((z) => z.id === nextSample.zoneId)?.name ?? null;
  }, [nextSample, plan?.zones]);

  const saveMovedPoint = useCallback(async () => {
    if (!sample || !coords) return;
    setMovingPoint(true);
    try {
      await updateSample(sample.id, {
        latitude: coords.latitude,
        longitude: coords.longitude,
        geometry: { type: "Point", coordinates: [coords.longitude, coords.latitude] },
      });
      setPointMoved(true);
      queryClient.invalidateQueries({ queryKey: getListSamplingPlansQueryKey(), exact: false });
      queryClient.invalidateQueries({ queryKey: getGetSamplingPlanQueryKey(sample.planId), exact: false });
      Alert.alert("Point updated", "The planned location now matches where you pulled the sample.");
    } catch (err) {
      Alert.alert(
        "Couldn't move point",
        err instanceof Error ? err.message : "Try again once you have a connection.",
      );
    } finally {
      setMovingPoint(false);
    }
  }, [sample, coords, queryClient]);

  const alreadyCollected = useMemo(
    () => !!sample && sample.status !== "planned",
    [sample],
  );

  const notFound = useMemo(() => {
    if (!isError) return false;
    const status = (error as { status?: number } | null)?.status;
    return status === 404;
  }, [isError, error]);

  // When no sample carries the scanned code, see whether it's a recognized
  // pre-printed (blank) bag label so we can offer to start a sample with it,
  // rather than dead-ending. Only fires on the not-found path.
  const { data: qrCode, isLoading: qrLoading } = useGetSampleQrCodeByCode(code, {
    query: {
      enabled: notFound && code.length > 0,
      retry: false,
      queryKey: getGetSampleQrCodeByCodeQueryKey(code),
    },
  });
  const qrChecking = notFound && code.length > 0 && qrLoading;
  const isRecognizedBlank = notFound && !qrLoading && qrCode?.status === "unassigned";
  // Defensive: a recognized label already bound to a sample shouldn't reach the
  // not-found path (by-code would have matched), but handle the drift/race case
  // distinctly instead of mislabeling it "not found".
  const isRecognizedAssigned = notFound && !qrLoading && qrCode?.status === "assigned";

  const captureGps = useCallback(async () => {
    setCapturingGps(true);
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (!perm.granted) {
        Alert.alert("Location needed", "Allow location access to tag where the sample was pulled.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      Alert.alert("Location failed", "Couldn't read your position. Try again.");
    } finally {
      setCapturingGps(false);
    }
  }, []);

  const addPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera needed", "Allow camera access to attach a collection photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setPhoto({
      uri: asset.uri,
      contentType: asset.mimeType ?? "image/jpeg",
      filename: asset.fileName ?? `sample-${Date.now()}.jpg`,
    });
  }, []);

  const finish = useCallback(() => {
    // When launched from the guided session, return to it explicitly so the rep
    // lands back on the map and the next point auto-advances — even if the back
    // stack was lost (e.g. collect reopened via deep link).
    if (params.from === "guided") {
      const planId = sample?.planId;
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace(
          (planId ? `/sampling/guided?planId=${planId}` : "/sampling/guided") as never,
        );
      }
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [params.from, sample?.planId]);

  // One-tap advance: jump straight into the next point's collect screen (reuses
  // this screen via replace; the code-change effect resets inputs). If that point
  // has no bag id yet, drop back to the guided map where one can be generated.
  const goToNext = useCallback(() => {
    if (!nextSample) {
      finish();
      return;
    }
    if (nextSample.trackingCode) {
      router.replace(
        `/sampling/collect?code=${encodeURIComponent(nextSample.trackingCode)}&from=guided` as never,
      );
    } else {
      router.replace(
        (sample?.planId ? `/sampling/guided?planId=${sample.planId}` : "/sampling/guided") as never,
      );
    }
  }, [nextSample, sample?.planId, finish]);

  const confirmCollect = useCallback(async () => {
    if (!sample) return;
    setSubmitting(true);
    const collectedAt = new Date().toISOString();
    const trimmedNote = notes.trim();
    try {
      if (isOnline) {
        // Online: upload the photo (if any) for a media id, then transition.
        let collectionPhotoMediaId: number | undefined;
        if (photo) {
          try {
            const token = await getToken();
            const domain = process.env.EXPO_PUBLIC_DOMAIN;
            if (token && domain) {
              const blob = await (await fetch(photo.uri)).blob();
              const upRes = await fetch(
                `https://${domain}/api/media-attachments/upload?sampleId=${sample.id}`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": photo.contentType,
                    "x-filename": encodeURIComponent(photo.filename),
                    Authorization: `Bearer ${token}`,
                  },
                  body: blob,
                },
              );
              if (upRes.ok) {
                const media = (await upRes.json()) as { id?: number };
                if (typeof media.id === "number") collectionPhotoMediaId = media.id;
              }
            }
          } catch {
            // Photo upload is best-effort; proceed with the collection regardless.
          }
        }
        await transitionSample(sample.id, {
          status: "collected",
          note: trimmedNote || undefined,
          latitude: coords?.latitude,
          longitude: coords?.longitude,
          collectionPhotoMediaId,
          collectedAt,
        });
        queryClient.invalidateQueries({ queryKey: getListSamplingPlansQueryKey(), exact: false });
        queryClient.invalidateQueries({ queryKey: getGetSamplingPlanQueryKey(sample.planId), exact: false });
        collectedIdsRef.current.add(sample.id);
        if (guided) {
          setCollected(true);
        } else {
          Alert.alert("Sample collected", `${sample.trackingCode ?? "Sample"} marked as collected.`);
          finish();
        }
      } else {
        // Offline: queue the transition; photo is uploaded at flush time from
        // its local URI inside the QueueSync handler.
        await queueWrite("sampleTransition", {
          sampleId: sample.id,
          status: "collected",
          note: trimmedNote || null,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          collectedAt,
          photoLocalUri: photo?.uri ?? null,
          photoContentType: photo?.contentType ?? null,
          photoFilename: photo?.filename ?? null,
        });
        triggerFlush();
        collectedIdsRef.current.add(sample.id);
        if (guided) {
          setCollected(true);
        } else {
          Alert.alert(
            "Saved offline",
            `${sample.trackingCode ?? "Sample"} will sync as collected when you're back online.`,
          );
          finish();
        }
      }
    } catch (err) {
      Alert.alert(
        "Couldn't save",
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    sample,
    notes,
    photo,
    coords,
    isOnline,
    getToken,
    queueWrite,
    triggerFlush,
    queryClient,
    finish,
    guided,
  ]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {sample && (
        <ScanReportModal
          visible={scanModalOpen}
          onClose={() => setScanModalOpen(false)}
          sample={sample}
          colors={colors}
          getToken={getToken}
        />
      )}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={finish} hitSlop={12} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Collect Sample</Text>
        <View style={styles.backBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>Looking up {code}…</Text>
        </View>
      ) : notFound ? (
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
            gap: 14,
          }}
        >
          <View
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.muted,
              marginBottom: 4,
            }}
          >
            <Feather
              name={isRecognizedBlank ? "tag" : isRecognizedAssigned ? "link" : "alert-circle"}
              size={28}
              color={colors.mutedForeground}
            />
          </View>

          {qrChecking ? (
            <>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.muted, { color: colors.mutedForeground, textAlign: "center" }]}>
                Checking label “{code}”…
              </Text>
            </>
          ) : isRecognizedBlank ? (
            <>
              <Text style={[styles.cardTitle, { color: colors.text, textAlign: "center" }]}>
                Blank label scanned
              </Text>
              <Text style={[styles.muted, { color: colors.mutedForeground, textAlign: "center" }]}>
                “{code}” is a printed bag label that isn’t linked to a sample yet. Start a new sample
                to attach it.
              </Text>
              <Pressable
                onPress={() =>
                  router.replace(`/sampling/new?pendingCode=${encodeURIComponent(code)}` as never)
                }
                style={[
                  styles.primaryBtn,
                  {
                    backgroundColor: colors.primary,
                    marginTop: 4,
                    flexDirection: "row",
                    gap: 8,
                    justifyContent: "center",
                    paddingHorizontal: 20,
                  },
                ]}
              >
                <Feather name="plus" size={16} color={colors.primaryForeground} />
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                  Record a new sample with this label
                </Text>
              </Pressable>
            </>
          ) : isRecognizedAssigned ? (
            <>
              <Text style={[styles.cardTitle, { color: colors.text, textAlign: "center" }]}>
                Label already in use
              </Text>
              <Text style={[styles.muted, { color: colors.mutedForeground, textAlign: "center" }]}>
                “{code}” is already attached to another sample. Open that sample from its plan, or
                scan a different bag.
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.cardTitle, { color: colors.text, textAlign: "center" }]}>
                Sample not found
              </Text>
              <Text style={[styles.muted, { color: colors.mutedForeground, textAlign: "center" }]}>
                No sample matches “{code}”. Check the label and scan again.
              </Text>
            </>
          )}

          <Pressable
            onPress={() => router.replace("/sampling/scan" as never)}
            style={[styles.secondaryBtn, { borderColor: colors.primary, marginTop: 4 }]}
          >
            <Feather name="camera" size={16} color={colors.primary} />
            <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Scan another bag</Text>
          </Pressable>
          <Pressable onPress={finish} style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>Go back</Text>
          </Pressable>
        </ScrollView>
      ) : isError || !sample ? (
        <EmptyState
          icon="wifi-off"
          title="Lookup failed"
          subtitle="Couldn't look up that sample. Check your connection and try again."
        />
      ) : collected ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 16 }}
        >
          <View style={styles.successIcon}>
            <Feather name="check" size={34} color="#fff" />
          </View>
          <Text style={[styles.successTitle, { color: colors.text }]}>
            {isOnline ? "Sample collected" : "Saved offline"}
          </Text>
          <Text style={[styles.muted, { color: colors.mutedForeground, textAlign: "center" }]}>
            {sample.trackingCode ? `${sample.trackingCode} ` : "This sample "}
            {isOnline ? "is marked collected." : "will sync as collected when you're back online."}
          </Text>

          {nextSample ? (
            <>
              <Pressable
                onPress={goToNext}
                style={[
                  styles.primaryBtn,
                  { backgroundColor: colors.primary, flexDirection: "row", gap: 8, justifyContent: "center" },
                ]}
              >
                <Feather name="arrow-right-circle" size={18} color={colors.primaryForeground} />
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                  Next point
                </Text>
              </Pressable>
              <Text style={[styles.muted, { color: colors.mutedForeground, textAlign: "center" }]}>
                {nextSample.label || nextSample.trackingCode || `Sample ${nextSample.id}`}
                {nextZoneName ? ` · ${nextZoneName}` : ""}
                {!nextSample.trackingCode ? " · needs a bag ID" : ""}
              </Text>
            </>
          ) : (
            <Text style={[styles.successTitle, { color: "#16a34a", fontSize: 16 }]}>
              All points in this plan are collected.
            </Text>
          )}

          <Pressable
            onPress={finish}
            style={[styles.secondaryBtn, { borderColor: colors.primary }]}
          >
            <Feather name="map" size={16} color={colors.primary} />
            <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Back to map</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}
        >
          <SampleSummary sample={sample} colors={colors} />

          {alreadyCollected ? (
            <View
              style={[
                styles.notice,
                { backgroundColor: colors.warningBackground, borderColor: colors.warning },
              ]}
            >
              <Feather name="info" size={16} color={colors.warning} />
              <Text style={[styles.noticeText, { color: colors.text }]}>
                This sample is already marked “{statusLabel(sample.status)}”. Collecting again will
                update its timestamp and location.
              </Text>
            </View>
          ) : null}

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Location</Text>
            {coords ? (
              <Text style={[styles.coords, { color: colors.mutedForeground }]}>
                {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
              </Text>
            ) : (
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                No GPS captured yet.
              </Text>
            )}
            <Pressable
              onPress={captureGps}
              disabled={capturingGps}
              style={[
                styles.secondaryBtn,
                { borderColor: colors.primary, opacity: capturingGps ? 0.6 : 1 },
              ]}
            >
              {capturingGps ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Feather name="map-pin" size={16} color={colors.primary} />
              )}
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                {coords ? "Update GPS" : "Capture GPS"}
              </Text>
            </Pressable>

            {farFromPlanned ? (
              <View
                style={[
                  styles.notice,
                  { backgroundColor: colors.warningBackground, borderColor: colors.warning },
                ]}
              >
                <Feather name="alert-triangle" size={16} color={colors.warning} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Text style={[styles.noticeText, { color: colors.text }]}>
                    You're about {Math.round(distanceFromPlannedFt ?? 0)} ft from the planned point.
                    If you pulled here on purpose, update the point's saved location.
                  </Text>
                  {isOnline ? (
                    <Pressable
                      onPress={saveMovedPoint}
                      disabled={movingPoint}
                      style={[
                        styles.secondaryBtn,
                        { borderColor: colors.warning, opacity: movingPoint ? 0.6 : 1 },
                      ]}
                    >
                      {movingPoint ? (
                        <ActivityIndicator size="small" color={colors.warning} />
                      ) : (
                        <Feather name="map-pin" size={16} color={colors.warning} />
                      )}
                      <Text style={[styles.secondaryBtnText, { color: colors.warning }]}>
                        Save this as the point's location
                      </Text>
                    </Pressable>
                  ) : (
                    <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                      Reconnect to move the saved point.
                    </Text>
                  )}
                </View>
              </View>
            ) : pointMoved ? (
              <View style={styles.offlineRow}>
                <Feather name="check-circle" size={14} color="#16a34a" />
                <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                  Planned point moved to here.
                </Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Photo (optional)</Text>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" />
            ) : null}
            <Pressable
              onPress={addPhoto}
              style={[styles.secondaryBtn, { borderColor: colors.primary }]}
            >
              <Feather name="camera" size={16} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                {photo ? "Retake photo" : "Add photo"}
              </Text>
            </Pressable>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Lab results (optional)</Text>
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>
              Have the lab report? Scan it to enter nutrient values.
            </Text>
            <Pressable
              onPress={() => setScanModalOpen(true)}
              style={[styles.secondaryBtn, { borderColor: colors.primary }]}
            >
              <Feather name="file-text" size={16} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Scan lab report</Text>
            </Pressable>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Notes (optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything worth noting about this pull…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.input, backgroundColor: colors.background },
              ]}
            />
          </View>

          {!isOnline ? (
            <View style={styles.offlineRow}>
              <Feather name="wifi-off" size={14} color={colors.mutedForeground} />
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                Offline — this will sync automatically.
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={confirmCollect}
            disabled={submitting}
            style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                Mark as collected
              </Text>
            )}
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

type ScanAnalyteRow = {
  analyteCode: string;
  value: string;
  unit: string;
  flagged: boolean;
};

interface SoilScanResult {
  reportDate: string | null;
  labNumber: string | null;
  sampleType: string;
  analytes: Array<{
    analyteCode: string;
    analyteName: string;
    value: number | null;
    textValue: string | null;
    unit: string | null;
    flagged: boolean;
  }>;
  pageCount?: number;
  pagesScanned?: number;
}

function ScanReportModal({
  visible,
  onClose,
  sample,
  colors,
  getToken,
}: {
  visible: boolean;
  onClose: () => void;
  sample: SampleLookup;
  colors: ReturnType<typeof useColors>;
  getToken: () => Promise<string | null>;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  type ScanStep = "pick" | "scanning" | "review" | "saving";
  const [step, setStep] = useState<ScanStep>("pick");
  const [scanPhotoUri, setScanPhotoUri] = useState<string | null>(null);
  const [scanIsPdf, setScanIsPdf] = useState(false);
  const [scanFileName, setScanFileName] = useState<string | null>(null);
  const [pageInfo, setPageInfo] = useState<{ pageCount: number; pagesScanned: number } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [reportDate, setReportDate] = useState("");
  const [labNumber, setLabNumber] = useState("");
  const [rows, setRows] = useState<ScanAnalyteRow[]>([]);
  // Keeps the raw picked asset so the image can be uploaded as a media attachment
  // at explicit-confirm time (not eagerly at scan time, to respect the user's intent).
  const pendingScanAssetRef = useRef<{ uri: string; contentType: string; filename: string } | null>(null);

  const reset = useCallback(() => {
    setStep("pick");
    setScanPhotoUri(null);
    setScanIsPdf(false);
    setScanFileName(null);
    setPageInfo(null);
    setScanError(null);
    setReportDate("");
    setLabNumber("");
    setRows([]);
    pendingScanAssetRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const uploadAndScan = useCallback(async (uri: string, contentType: string, filename: string) => {
    const isPdf = contentType.includes("application/pdf");
    setScanIsPdf(isPdf);
    setScanFileName(filename);
    setScanPhotoUri(uri);
    setStep("scanning");
    setScanError(null);
    // Store the asset so we can upload it as a media attachment at explicit-confirm time.
    // We do NOT pass sampleId here — nothing is persisted until the user taps Save.
    pendingScanAssetRef.current = { uri, contentType, filename };
    try {
      const token = await getToken();
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (!token || !domain) throw new Error("Not authenticated");
      const blob = await (await fetch(uri)).blob();
      const scanRes = await fetch(`https://${domain}/api/precision-ag/scan-soil-report`, {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          "x-filename": encodeURIComponent(filename),
          Authorization: `Bearer ${token}`,
        },
        body: blob,
      });
      if (!scanRes.ok) {
        const errBody = await scanRes.json().catch(() => ({ error: "Extraction failed" })) as { error?: string };
        throw new Error(errBody.error ?? "Extraction failed");
      }
      const result = (await scanRes.json()) as SoilScanResult;
      setReportDate(result.reportDate ?? "");
      setLabNumber(result.labNumber ?? "");
      setPageInfo(
        result.pageCount != null && result.pagesScanned != null
          ? { pageCount: result.pageCount, pagesScanned: result.pagesScanned }
          : null,
      );
      setRows(
        result.analytes.length > 0
          ? result.analytes.map((a) => ({
              analyteCode: a.analyteCode,
              value: a.value != null ? String(a.value) : (a.textValue ?? ""),
              unit: a.unit ?? "",
              flagged: a.flagged,
            }))
          : [{ analyteCode: "", value: "", unit: "", flagged: false }],
      );
      setStep("review");
    } catch (err) {
      pendingScanAssetRef.current = null;
      setScanError(err instanceof Error ? err.message : "Could not read this report. Try a clearer photo and try again.");
      setStep("pick");
    }
  }, [getToken]);

  const takePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera needed", "Allow camera access to scan a report.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    void uploadAndScan(asset.uri, asset.mimeType ?? "image/jpeg", asset.fileName ?? `scan-${Date.now()}.jpg`);
  }, [uploadAndScan]);

  const pickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photos access needed", "Allow photo library access to pick a report image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    void uploadAndScan(asset.uri, asset.mimeType ?? "image/jpeg", asset.fileName ?? `scan-${Date.now()}.jpg`);
  }, [uploadAndScan]);

  const pickPdf = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    void uploadAndScan(asset.uri, asset.mimeType ?? "application/pdf", asset.name ?? `report-${Date.now()}.pdf`);
  }, [uploadAndScan]);

  const saveResults = useCallback(async () => {
    const validRows = rows.filter((r) => r.analyteCode.trim());
    if (validRows.length === 0) {
      Alert.alert("No analytes", "Add at least one analyte before saving.");
      return;
    }
    setStep("saving");

    // Upload the scan image as a media attachment linked to this sample.
    // This is the explicit-confirm moment — nothing was persisted before now.
    // Block the save if the upload fails so we never create an orphaned result
    // with no traceable source image.
    let mediaAttachmentId: number | undefined;
    const asset = pendingScanAssetRef.current;
    if (asset) {
      try {
        const token = await getToken();
        const domain = process.env.EXPO_PUBLIC_DOMAIN;
        if (!token || !domain) throw new Error("Not authenticated");
        const blob = await (await fetch(asset.uri)).blob();
        const attRes = await fetch(
          `https://${domain}/api/media-attachments/upload?sampleId=${sample.id}`,
          {
            method: "POST",
            headers: {
              "Content-Type": asset.contentType,
              "x-filename": encodeURIComponent(asset.filename),
              Authorization: `Bearer ${token}`,
            },
            body: blob,
          },
        );
        if (!attRes.ok) throw new Error(`Attachment upload failed (${attRes.status})`);
        const att = (await attRes.json()) as { id?: number };
        if (att.id) mediaAttachmentId = att.id;
      } catch (err) {
        Alert.alert(
          "Could not save image",
          "The scanned report photo could not be uploaded. Check your connection and try again.",
        );
        setStep("review");
        return;
      }
    }

    try {
      await createSampleLabResult(sample.id, {
        sampleType: sample.sampleType,
        labNumber: labNumber.trim() || undefined,
        reportDate: reportDate || undefined,
        mediaAttachmentId,
        analytes: validRows.map((r) => ({
          analyteCode: r.analyteCode.trim(),
          value: r.value.trim() === "" ? null : Number(r.value),
          unit: r.unit.trim() || undefined,
        })),
      });
      queryClient.invalidateQueries({ queryKey: getListSamplingPlansQueryKey(), exact: false });
      Alert.alert("Saved", "Lab results saved from scanned report.", [{ text: "OK", onPress: handleClose }]);
    } catch {
      Alert.alert("Save failed", "Could not save results. Try again.");
      setStep("review");
    }
  }, [sample, rows, labNumber, reportDate, getToken, queryClient, handleClose]);

  const flaggedCount = rows.filter((r) => r.flagged).length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={[scanStyles.root, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        <View style={[scanStyles.header, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
          <Pressable onPress={handleClose} hitSlop={12} style={scanStyles.headerBtn}>
            <Feather name="x" size={22} color={colors.text} />
          </Pressable>
          <Text style={[scanStyles.headerTitle, { color: colors.text }]}>Scan lab report</Text>
          <View style={scanStyles.headerBtn} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}>
          {step === "pick" && (
            <View style={{ gap: 12 }}>
              {scanError ? (
                <View style={[scanStyles.warningBox, { backgroundColor: colors.warningBackground, borderColor: colors.warning }]}>
                  <Feather name="alert-triangle" size={16} color={colors.warning} />
                  <Text style={[scanStyles.warningText, { color: colors.text }]}>{scanError}</Text>
                </View>
              ) : null}
              <View style={[scanStyles.instructionBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="file-text" size={28} color={colors.mutedForeground} />
                <Text style={[scanStyles.instructionTitle, { color: colors.text }]}>Photograph your lab report</Text>
                <Text style={[scanStyles.instructionText, { color: colors.mutedForeground }]}>
                  Take or choose a clear, well-lit photo of the full report page. All analyte rows will be extracted automatically.
                </Text>
              </View>
              <Pressable
                onPress={takePhoto}
                style={[scanStyles.actionBtn, { borderColor: colors.primary }]}
              >
                <Feather name="camera" size={18} color={colors.primary} />
                <Text style={[scanStyles.actionBtnText, { color: colors.primary }]}>Take a photo</Text>
              </Pressable>
              <Pressable
                onPress={pickPhoto}
                style={[scanStyles.actionBtn, { borderColor: colors.border }]}
              >
                <Feather name="image" size={18} color={colors.text} />
                <Text style={[scanStyles.actionBtnText, { color: colors.text }]}>Choose from library</Text>
              </Pressable>
              <Pressable
                onPress={pickPdf}
                style={[scanStyles.actionBtn, { borderColor: colors.border }]}
              >
                <Feather name="file" size={18} color={colors.text} />
                <Text style={[scanStyles.actionBtnText, { color: colors.text }]}>Choose PDF from files</Text>
              </Pressable>
            </View>
          )}

          {step === "scanning" && (
            <View style={[scanStyles.scanningContainer]}>
              {scanPhotoUri && (
                scanIsPdf ? (
                  <View style={[scanStyles.pdfPreview, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Feather name="file-text" size={28} color={colors.mutedForeground} />
                    <Text style={[scanStyles.instructionText, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {scanFileName ?? "PDF report"}
                    </Text>
                  </View>
                ) : (
                  <Image source={{ uri: scanPhotoUri }} style={scanStyles.previewImg} resizeMode="contain" />
                )
              )}
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={[scanStyles.instructionText, { color: colors.mutedForeground, textAlign: "center" }]}>
                {scanIsPdf ? "Rendering PDF and reading analyte values…" : "Reading analyte values…"}
              </Text>
            </View>
          )}

          {(step === "review" || step === "saving") && (
            <View style={{ gap: 12 }}>
              {scanPhotoUri && (
                scanIsPdf ? (
                  <View style={[scanStyles.pdfPreview, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Feather name="file-text" size={24} color={colors.mutedForeground} />
                    <Text style={[scanStyles.instructionText, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {scanFileName ?? "PDF report"}
                      {pageInfo
                        ? ` — ${pageInfo.pagesScanned} page${pageInfo.pagesScanned !== 1 ? "s" : ""} scanned`
                        : " — scanned"}
                    </Text>
                  </View>
                ) : (
                  <Image source={{ uri: scanPhotoUri }} style={scanStyles.previewImg} resizeMode="contain" />
                )
              )}

              {pageInfo && pageInfo.pageCount > pageInfo.pagesScanned && (
                <View style={[scanStyles.warningBox, { backgroundColor: colors.warningBackground, borderColor: colors.warning }]}>
                  <Feather name="alert-triangle" size={16} color={colors.warning} />
                  <Text style={[scanStyles.warningText, { color: colors.text }]}>
                    Scanned the first {pageInfo.pagesScanned} of {pageInfo.pageCount} pages. Remaining pages were skipped — add any missing analytes manually.
                  </Text>
                </View>
              )}

              {flaggedCount > 0 && (
                <View style={[scanStyles.warningBox, { backgroundColor: colors.warningBackground, borderColor: colors.warning }]}>
                  <Feather name="alert-triangle" size={16} color={colors.warning} />
                  <Text style={[scanStyles.warningText, { color: colors.text }]}>
                    {flaggedCount} row{flaggedCount !== 1 ? "s" : ""} flagged — verify highlighted values.
                  </Text>
                </View>
              )}

              <View style={[scanStyles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[scanStyles.cardTitle, { color: colors.text }]}>Report details</Text>
                <View style={{ gap: 8 }}>
                  <View>
                    <Text style={[scanStyles.fieldLabel, { color: colors.mutedForeground }]}>Lab number</Text>
                    <TextInput
                      value={labNumber}
                      onChangeText={setLabNumber}
                      placeholder="Optional"
                      placeholderTextColor={colors.mutedForeground}
                      style={[scanStyles.input, { color: colors.text, borderColor: colors.input, backgroundColor: colors.background }]}
                    />
                  </View>
                  <View>
                    <Text style={[scanStyles.fieldLabel, { color: colors.mutedForeground }]}>Report date</Text>
                    <TextInput
                      value={reportDate}
                      onChangeText={setReportDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.mutedForeground}
                      style={[scanStyles.input, { color: colors.text, borderColor: colors.input, backgroundColor: colors.background }]}
                    />
                  </View>
                </View>
              </View>

              <View style={[scanStyles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[scanStyles.cardTitle, { color: colors.text }]}>Analytes ({rows.length})</Text>
                {rows.map((row, i) => (
                  <View
                    key={i}
                    style={[
                      scanStyles.analyteRow,
                      row.flagged && { backgroundColor: colors.warningBackground, borderRadius: 8, padding: 4 },
                    ]}
                  >
                    {row.flagged && (
                      <Feather name="alert-triangle" size={12} color={colors.warning} style={{ marginRight: 2 }} />
                    )}
                    <TextInput
                      value={row.analyteCode}
                      onChangeText={(t) => setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, analyteCode: t, flagged: false } : r))}
                      placeholder="code"
                      placeholderTextColor={colors.mutedForeground}
                      style={[scanStyles.analyteInput, scanStyles.analyteCodeInput, { color: colors.text, borderColor: row.flagged ? colors.warning : colors.input, backgroundColor: colors.background }]}
                    />
                    <TextInput
                      value={row.value}
                      onChangeText={(t) => setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, value: t, flagged: false } : r))}
                      placeholder="value"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="decimal-pad"
                      style={[scanStyles.analyteInput, scanStyles.analyteValueInput, { color: colors.text, borderColor: row.flagged ? colors.warning : colors.input, backgroundColor: colors.background }]}
                    />
                    <TextInput
                      value={row.unit}
                      onChangeText={(t) => setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, unit: t } : r))}
                      placeholder="unit"
                      placeholderTextColor={colors.mutedForeground}
                      style={[scanStyles.analyteInput, scanStyles.analyteUnitInput, { color: colors.text, borderColor: colors.input, backgroundColor: colors.background }]}
                    />
                    <Pressable
                      onPress={() => setRows((rs) => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs)}
                      hitSlop={8}
                      style={scanStyles.removeBtn}
                    >
                      <Feather name="x" size={16} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                ))}
                <Pressable
                  onPress={() => setRows((rs) => [...rs, { analyteCode: "", value: "", unit: "", flagged: false }])}
                  style={[scanStyles.addRowBtn, { borderColor: colors.border }]}
                >
                  <Feather name="plus" size={14} color={colors.mutedForeground} />
                  <Text style={[scanStyles.addRowText, { color: colors.mutedForeground }]}>Add row</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={saveResults}
                disabled={step === "saving"}
                style={[scanStyles.primaryBtn, { backgroundColor: colors.primary, opacity: step === "saving" ? 0.6 : 1 }]}
              >
                {step === "saving" ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={[scanStyles.primaryBtnText, { color: colors.primaryForeground }]}>Save results</Text>
                )}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const scanStyles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 17 },
  instructionBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  instructionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, textAlign: "center" },
  instructionText: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center", lineHeight: 18 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
  },
  actionBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  scanningContainer: { alignItems: "center", gap: 16, paddingVertical: 24 },
  previewImg: { width: "100%", height: 200, borderRadius: 10 },
  pdfPreview: {
    width: "100%",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 8,
  },
  warningBox: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  warningText: { fontFamily: "Inter_400Regular", fontSize: 13, flex: 1, lineHeight: 18 },
  formCard: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, marginBottom: 2 },
  fieldLabel: { fontFamily: "Inter_500Medium", fontSize: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  analyteRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  analyteInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  analyteCodeInput: { flex: 2 },
  analyteValueInput: { flex: 1.5 },
  analyteUnitInput: { flex: 1 },
  removeBtn: { padding: 4 },
  addRowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    marginTop: 2,
  },
  addRowText: { fontFamily: "Inter_400Regular", fontSize: 13 },
  primaryBtn: { borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  primaryBtnText: { fontFamily: "Inter_700Bold", fontSize: 16 },
});

function SampleSummary({
  sample,
  colors,
}: {
  sample: SampleLookup;
  colors: ReturnType<typeof useColors>;
}) {
  const rows: Array<[string, string]> = [
    ["Type", sample.sampleType],
    ["Status", statusLabel(sample.status)],
  ];
  if (sample.customerName) rows.push(["Customer", sample.customerName]);
  if (sample.fieldName) rows.push(["Field", sample.fieldName]);
  if (sample.planName) rows.push(["Plan", sample.planName]);
  if (sample.zoneName) rows.push(["Zone", sample.zoneName]);
  if (sample.label) rows.push(["Label", sample.label]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.trackingCode, { color: colors.primary }]}>
        {sample.trackingCode ?? "(no code)"}
      </Text>
      {sample.trackingCode ? (
        <Text style={[styles.muted, { color: colors.mutedForeground, textAlign: "center" }]}>
          Write this on the bag if it has no printed label
        </Text>
      ) : null}
      <View style={{ gap: 6, marginTop: 8 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{label}</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]} numberOfLines={1}>
              {value}
            </Text>
          </View>
        ))}
      </View>
      {sample.planId ? (
        <Pressable
          onPress={() => router.push(`/sampling/${sample.planId}` as never)}
          style={[styles.planLink, { borderColor: colors.primary }]}
        >
          <Feather name="layers" size={15} color={colors.primary} />
          <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>View full plan</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 17 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  muted: { fontFamily: "Inter_400Regular", fontSize: 13 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  trackingCode: { fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: 1 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  summaryLabel: { fontFamily: "Inter_500Medium", fontSize: 13 },
  summaryValue: { fontFamily: "Inter_500Medium", fontSize: 13, flexShrink: 1, textAlign: "right" },
  coords: { fontFamily: "Inter_500Medium", fontSize: 14 },
  notice: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeText: { fontFamily: "Inter_400Regular", fontSize: 13, flex: 1, lineHeight: 18 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
  },
  secondaryBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  planLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 4,
  },
  preview: { width: "100%", height: 180, borderRadius: 10 },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlignVertical: "top",
  },
  offlineRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
  primaryBtn: { borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  primaryBtnText: { fontFamily: "Inter_700Bold", fontSize: 16 },
  successIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16a34a",
  },
  successTitle: { fontFamily: "Inter_700Bold", fontSize: 20, textAlign: "center" },
});
