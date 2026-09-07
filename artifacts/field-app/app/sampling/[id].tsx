import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  generateSamplingGrid,
  getGetSamplingPlanQueryKey,
  getListSamplingPlansQueryKey,
  useGetSamplingPlan,
  type Sample,
  type SamplingZone,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { useColors } from "@/hooks/useColors";
import { useOffline, type SamplingGridPayload } from "@/context/OfflineContext";

// Preset cell sizes (acres) for the "generate grid" action. 5 ac is a common
// default for a soil sampling grid; smaller = denser (more points/zones).
const GRID_CELL_PRESETS = [1, 2.5, 5, 10];

const SAMPLE_STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  collected: "Collected",
  shipped: "Shipped",
  at_lab: "At Lab",
  results_received: "Results Received",
};

// Legacy rows may still carry "submitted"/"complete"; fold those onto the
// canonical lifecycle so old samples still show a sensible label, matching the
// web sampling-detail page.
function normalizeSampleStatus(status: string): string {
  if (status === "submitted") return "shipped";
  if (status === "complete" || status === "completed") return "results_received";
  return status;
}

function sampleStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  const norm = normalizeSampleStatus(status);
  return SAMPLE_STATUS_LABELS[norm] ?? titleCase(norm);
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SamplingPlanDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const planId = parseInt(params.id ?? "0", 10);

  const {
    data: plan,
    isLoading,
  } = useGetSamplingPlan(planId, {
    query: { enabled: !!planId, queryKey: getGetSamplingPlanQueryKey(planId) },
  });

  const [showGridModal, setShowGridModal] = React.useState(false);

  const invalidate = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getGetSamplingPlanQueryKey(planId) });
    await queryClient.invalidateQueries({ queryKey: getListSamplingPlansQueryKey() });
  }, [planId, queryClient]);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  const zones = plan?.zones ?? [];
  const samples = plan?.samples ?? [];

  // Summary derives from the same plan query, so it stays in sync whenever the
  // plan refetches (e.g. after a zone is added or a point dropped on the web).
  const totalZones = zones.length;
  const totalSamples = samples.length;
  const totalAcres = zones.reduce((sum, z) => sum + (z.acres ?? 0), 0);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.topBar,
          { paddingTop: topPadding + 8, borderBottomColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="back-button">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {plan?.name ?? "Sampling Plan"}
          </Text>
          {plan ? (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              {[
                plan.customerName,
                plan.fieldName ?? `Field ${plan.fieldId}`,
                plan.fieldAcres != null ? `${plan.fieldAcres.toFixed(1)} ac` : null,
                plan.season,
              ]
                .filter(Boolean)
                .join(" · ") || "Plan details"}
            </Text>
          ) : null}
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
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100, gap: 16 }}>
          <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
            {titleCase(plan.status)}
          </Text>

          {plan.sampleTypes?.length ? (
            <View style={styles.badgeRow}>
              {plan.sampleTypes.map((t) => (
                <View
                  key={t}
                  style={[styles.badge, { borderColor: colors.border, backgroundColor: colors.card }]}
                >
                  <Text style={[styles.badgeText, { color: colors.foreground }]}>{titleCase(t)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SummaryStat
              label="Zones"
              value={totalZones > 0 ? String(totalZones) : "—"}
              colors={colors}
            />
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <SummaryStat
              label="Samples"
              value={totalSamples > 0 ? String(totalSamples) : "—"}
              colors={colors}
            />
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <SummaryStat
              label="Total acreage"
              value={totalAcres > 0 ? `${totalAcres.toFixed(1)} ac` : "—"}
              colors={colors}
            />
          </View>

          {totalSamples > 0 ? (
            <Pressable
              onPress={() => router.push(`/sampling/guided?planId=${planId}` as never)}
              style={[styles.guidedBtn, { backgroundColor: colors.primary }]}
              testID="start-guided-button"
            >
              <Feather name="navigation" size={17} color={colors.primaryForeground} />
              <Text style={[styles.guidedBtnText, { color: colors.primaryForeground }]}>
                Start guided sampling
              </Text>
            </Pressable>
          ) : (
            // A brand-new plan has no points, so "Start guided sampling" can't
            // appear yet. Prompt the rep to add points on the spot so the plan is
            // usable end to end without hopping to the web app.
            <View style={[styles.emptyPrompt, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Feather name="map-pin" size={22} color={colors.primary} />
              <Text style={[styles.emptyPromptText, { color: colors.mutedForeground }]}>
                This plan has no sample points yet. Add points in the field or generate a grid to
                start guided sampling.
              </Text>
            </View>
          )}

          <View style={styles.actionsRow}>
            <Pressable
              onPress={() => router.push(`/sampling/build?planId=${planId}` as never)}
              style={[styles.actionBtn, { backgroundColor: colors.primary }]}
              testID="add-points-button"
            >
              <Feather name="map-pin" size={16} color={colors.primaryForeground} />
              <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>
                {totalSamples > 0 ? "Add / edit points" : "Add points"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setShowGridModal(true)}
              style={[styles.actionBtnOutline, { borderColor: colors.border, backgroundColor: colors.card }]}
              testID="generate-grid-button"
            >
              <Feather name="grid" size={16} color={colors.primary} />
              <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Generate grid</Text>
            </Pressable>
          </View>

          <View>
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
              Zones{totalZones ? ` (${totalZones})` : ""}
            </Text>
            {zones.length === 0 ? (
              <EmptyState
                icon="grid"
                title="No zones yet"
                subtitle="Zones drawn or imported for this plan will appear here."
              />
            ) : (
              <View style={{ gap: 8 }}>
                {zones.map((zone) => (
                  <ZoneRow key={zone.id} zone={zone} colors={colors} />
                ))}
              </View>
            )}
          </View>

          <View>
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
              Samples{totalSamples ? ` (${totalSamples})` : ""}
            </Text>
            {samples.length === 0 ? (
              <EmptyState
                icon="map-pin"
                title="No samples yet"
                subtitle="Sample points dropped for this plan will appear here."
              />
            ) : (
              <View style={{ gap: 8 }}>
                {samples.map((sample) => (
                  <SampleRow key={sample.id} sample={sample} colors={colors} />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      <GenerateGridModal
        visible={showGridModal}
        planId={planId}
        sampleType={plan?.sampleTypes?.[0] ?? "soil"}
        hasSamples={totalSamples > 0}
        onClose={() => setShowGridModal(false)}
        onGenerated={invalidate}
      />
    </View>
  );
}

function GenerateGridModal({
  visible,
  planId,
  sampleType,
  hasSamples,
  onClose,
  onGenerated,
}: {
  visible: boolean;
  planId: number;
  sampleType: string;
  hasSamples: boolean;
  onClose: () => void;
  onGenerated: () => Promise<void> | void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isOnline, queueWrite, triggerFlush } = useOffline();
  const [cellAcres, setCellAcres] = React.useState(5);
  const [replaceExisting, setReplaceExisting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // Reset the sheet each time it opens so a prior selection doesn't linger.
  React.useEffect(() => {
    if (visible) {
      setCellAcres(5);
      setReplaceExisting(false);
      setBusy(false);
    }
  }, [visible]);

  const generate = async () => {
    setBusy(true);
    try {
      // Offline: queue the grid request. The server computes the grid inside the
      // field boundary and creates the points when the queue flushes.
      if (!isOnline) {
        const payload: SamplingGridPayload = {
          planId,
          cellAcres,
          sampleType,
          replaceExisting: hasSamples ? replaceExisting : false,
        };
        await queueWrite("samplingGrid", payload);
        triggerFlush();
        onClose();
        Alert.alert(
          "Saved offline",
          "The sampling grid will be generated when you're back online.",
        );
        return;
      }
      const result = await generateSamplingGrid(planId, {
        cellAcres,
        sampleType,
        createSamples: true,
        replaceExisting: hasSamples ? replaceExisting : false,
      });
      await onGenerated();
      onClose();
      Alert.alert(
        "Grid generated",
        `Created ${result.samplesCreated} sample ${
          result.samplesCreated === 1 ? "point" : "points"
        } across ${result.zonesCreated} grid ${result.zonesCreated === 1 ? "cell" : "cells"}.`,
      );
    } catch (err) {
      // The server returns a clear message when the field has no boundary or no
      // cells fall inside it — surface it verbatim so the rep knows what to fix.
      Alert.alert(
        "Couldn't generate grid",
        err instanceof Error ? err.message : "Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Generate sampling grid</Text>
          <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>
            Evenly spaced points are dropped inside the field boundary. Smaller cells mean more
            points.
          </Text>

          <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Acres per cell</Text>
          <View style={styles.chipRow}>
            {GRID_CELL_PRESETS.map((val) => {
              const on = cellAcres === val;
              return (
                <Pressable
                  key={val}
                  onPress={() => setCellAcres(val)}
                  style={[
                    styles.chip,
                    {
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: on ? colors.primary : colors.background,
                    },
                  ]}
                  testID={`grid-cell-${val}`}
                >
                  <Text style={[styles.chipText, { color: on ? colors.primaryForeground : colors.foreground }]}>
                    {val} ac
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {hasSamples ? (
            <Pressable
              onPress={() => setReplaceExisting((v) => !v)}
              style={[styles.toggleRow, { borderColor: colors.border }]}
              testID="grid-replace-toggle"
            >
              <Feather
                name={replaceExisting ? "check-square" : "square"}
                size={20}
                color={replaceExisting ? colors.primary : colors.mutedForeground}
              />
              <Text style={[styles.toggleText, { color: colors.foreground }]}>
                Replace existing points & zones
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.sheetActions}>
            <Pressable
              onPress={onClose}
              disabled={busy}
              style={[styles.sheetCancelBtn, { borderColor: colors.border }]}
              testID="grid-cancel-button"
            >
              <Text style={[styles.sheetCancelText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={generate}
              disabled={busy}
              style={[styles.sheetConfirmBtn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
              testID="grid-confirm-button"
            >
              {busy ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.sheetConfirmText, { color: colors.primaryForeground }]}>Generate</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SummaryStat({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.summaryStat}>
      <Text style={[styles.summaryValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.summaryStatLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function ZoneRow({
  zone,
  colors,
}: {
  zone: SamplingZone;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
          {zone.name}
        </Text>
        {zone.source ? (
          <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
            {titleCase(zone.source)}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
        {zone.acres != null ? `${zone.acres.toFixed(1)} ac` : "—"}
      </Text>
    </View>
  );
}

function SampleRow({
  sample,
  colors,
}: {
  sample: Sample;
  colors: ReturnType<typeof useColors>;
}) {
  const title = sample.label || sample.trackingCode || `Sample ${sample.id}`;
  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
          {titleCase(sample.sampleType)}
        </Text>
      </View>
      <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
        {sampleStatusLabel(sample.status)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 10,
  },
  backBtn: { padding: 4 },
  titleWrap: { flex: 1 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
  },
  summaryStat: { flex: 1, alignItems: "center", gap: 2 },
  summaryValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  summaryStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  summaryDivider: { width: StyleSheet.hairlineWidth, alignSelf: "stretch", marginVertical: 6 },
  sectionLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  guidedBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
  },
  guidedBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  emptyPrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  emptyPromptText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  actionsRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
  },
  actionBtnOutline: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  rowMeta: { fontSize: 13, fontFamily: "Inter_500Medium" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  sheetSubtitle: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  sheetLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  chipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  toggleText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  sheetCancelBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
  },
  sheetCancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sheetConfirmBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 14,
  },
  sheetConfirmText: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
