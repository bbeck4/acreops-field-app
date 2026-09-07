import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useQueryClient } from "@tanstack/react-query";

import {
  AgFieldBoundary,
  FieldLayer,
  SamplingPlan,
  customFetch,
  getListFieldSamplingPlansQueryKey,
  useCreateSamplingPlan,
  useGetAgField,
  useListFieldBoundaries,
  useListFieldLayers,
  useListFieldSamplingPlans,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { FieldBoundaryMap } from "@/components/FieldBoundaryMap";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

const LAYER_ICONS: Record<string, string> = {
  yield_map: "🌽",
  as_applied: "💧",
  seeding: "🌱",
};
const LAYER_LABELS: Record<string, string> = {
  yield_map: "Yield Map",
  as_applied: "As-Applied",
  seeding: "Seeding",
};
const PLATFORM_LABELS: Record<string, string> = {
  jd_operations_center: "John Deere Ops Center",
  ag_leader: "Ag Leader",
  climate_fieldview: "Climate FieldView",
};
const PLAN_SAMPLE_TYPES = ["soil", "tissue", "sap"];

export default function AgFieldDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const fieldId = parseInt(id ?? "0", 10);

  const queryClient = useQueryClient();

  const { data: field } = useGetAgField(fieldId);
  const { data: boundaries, isLoading: loadingBoundaries } = useListFieldBoundaries(fieldId);
  const { data: layers, isLoading: loadingLayers } = useListFieldLayers(fieldId);
  const { data: samplingPlans, isLoading: loadingPlans } = useListFieldSamplingPlans(fieldId);

  const activeBoundary: AgFieldBoundary | undefined =
    boundaries?.find((b) => b.isActive) ?? boundaries?.[0];

  const createPlan = useCreateSamplingPlan();
  const { isOnline, queueWrite } = useOffline();
  const [showPlanForm, setShowPlanForm] = React.useState(false);
  const [planName, setPlanName] = React.useState("");
  const [planSeason, setPlanSeason] = React.useState(() => new Date().getFullYear().toString());
  const [planSampleTypes, setPlanSampleTypes] = React.useState<string[]>(["soil"]);

  const togglePlanSampleType = (t: string) =>
    setPlanSampleTypes((types) => (types.includes(t) ? types.filter((x) => x !== t) : [...types, t]));

  const submitPlan = async () => {
    if (!fieldId) return;
    if (planSampleTypes.length === 0) {
      Alert.alert("Pick a sample type", "Select at least one sample type for the plan.");
      return;
    }
    const season = planSeason.trim();
    const name = planName.trim() || `${season || "New"} Sampling`;
    // Generated request bodies reject null for optional fields — omit blanks
    // rather than sending null. customerId is derived server-side from the
    // field when omitted; pass it through when we already know it.
    const data: {
      fieldId: number;
      name: string;
      sampleTypes: string[];
      customerId?: number;
      season?: string;
    } = {
      fieldId,
      name,
      sampleTypes: planSampleTypes,
    };
    if (field?.customerId != null) data.customerId = field.customerId;
    if (season) data.season = season;

    const resetForm = () => {
      setShowPlanForm(false);
      setPlanName("");
      setPlanSeason(new Date().getFullYear().toString());
      setPlanSampleTypes(["soil"]);
    };

    // Offline: queue the create so the rep can set up sampling anywhere. It
    // syncs automatically when connectivity returns (see PendingSyncTray).
    const queueOffline = async () => {
      await queueWrite("samplingPlan", data);
      resetForm();
      Alert.alert(
        "Saved offline",
        "This sampling plan will sync automatically when you're back online.",
      );
    };

    if (!isOnline) {
      await queueOffline();
      return;
    }
    try {
      const plan = await createPlan.mutateAsync({ data });
      await queryClient.invalidateQueries({ queryKey: getListFieldSamplingPlansQueryKey(fieldId) });
      resetForm();
      router.push(`/sampling/${plan.id}` as never);
    } catch (e) {
      // A network failure while ostensibly "online" (flaky signal) should still
      // queue rather than error. Only surface an alert for genuine server
      // rejections (ApiError with a 4xx status).
      const status =
        e && typeof e === "object" && "status" in e ? (e as { status: number }).status : undefined;
      if (typeof status === "number" && status >= 400 && status < 500) {
        Alert.alert("Could not create plan", String((e as Error)?.message ?? e));
        return;
      }
      await queueOffline();
    }
  };

  const [showSoilForm, setShowSoilForm] = React.useState(false);
  const [soilDate, setSoilDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [soilLab, setSoilLab] = React.useState("");
  const [soilPh, setSoilPh] = React.useState("");
  const [soilOm, setSoilOm] = React.useState("");
  const [soilP, setSoilP] = React.useState("");
  const [soilK, setSoilK] = React.useState("");
  const [soilSavingState, setSoilSavingState] = React.useState<"idle" | "saving">("idle");

  const submitSoilTest = async () => {
    if (!fieldId) return;
    const num = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    setSoilSavingState("saving");
    try {
      // The soil-test create schema uses .optional() (not .nullable()), so blank
      // fields must be OMITTED — sending null fails validation and the save 400s.
      const body: Record<string, unknown> = {
        sampleDate: `${soilDate}T00:00:00.000Z`,
      };
      if (soilLab.trim()) body.labName = soilLab.trim();
      const numericFields: [string, string][] = [
        ["ph", soilPh],
        ["organicMatter", soilOm],
        ["phosphorus", soilP],
        ["potassium", soilK],
      ];
      for (const [key, raw] of numericFields) {
        const n = num(raw);
        if (n !== null) body[key] = n;
      }
      await customFetch(`/ag-fields/${fieldId}/soil-tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      Alert.alert("Saved", "Soil test recorded.");
      setShowSoilForm(false);
      setSoilLab(""); setSoilPh(""); setSoilOm(""); setSoilP(""); setSoilK("");
    } catch (e) {
      Alert.alert("Could not save", String((e as Error)?.message ?? e));
    } finally {
      setSoilSavingState("idle");
    }
  };

  const sortedLayers = React.useMemo(() => {
    if (!layers) return [] as FieldLayer[];
    return [...layers].sort((a, b) => {
      const ad = a.layerDate ? new Date(a.layerDate).getTime() : 0;
      const bd = b.layerDate ? new Date(b.layerDate).getTime() : 0;
      return bd - ad;
    });
  }, [layers]);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  const isLoading = loadingBoundaries || loadingLayers;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
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
            {field?.name ?? "Field"}
          </Text>
          {field ? (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              {[
                field.farmName,
                field.acres != null ? `${field.acres.toFixed(1)} ac` : null,
                field.cropPlan,
              ]
                .filter(Boolean)
                .join(" · ") || "Field details"}
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100, gap: 16 }}>
        {isLoading && !boundaries && !layers ? (
          <View style={{ padding: 32, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        <View>
          <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Boundary</Text>
          {activeBoundary ? (
            <>
              <FieldBoundaryMap
                geoJson={activeBoundary.geoJson}
                borderColor={colors.border}
                primaryColor={colors.primary}
              />
              <View style={styles.boundaryMeta}>
                {activeBoundary.acresCalculated != null ? (
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    {activeBoundary.acresCalculated.toFixed(1)} ac calculated
                  </Text>
                ) : null}
                {activeBoundary.versionLabel ? (
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    Version: {activeBoundary.versionLabel}
                  </Text>
                ) : null}
                {activeBoundary.importSource ? (
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    Source: {PLATFORM_LABELS[activeBoundary.importSource] ?? activeBoundary.importSource}
                  </Text>
                ) : null}
              </View>
            </>
          ) : (
            <View style={[styles.emptyBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Feather name="map" size={20} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No active boundary for this field
              </Text>
            </View>
          )}
        </View>

        <View>
          <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
            Synced Layers{sortedLayers.length ? ` (${sortedLayers.length})` : ""}
          </Text>
          {sortedLayers.length === 0 ? (
            <EmptyState
              icon="layers"
              title="No layers synced"
              subtitle="Yield, as-applied, and seeding data will appear here when synced from a connected platform."
            />
          ) : (
            <View style={{ gap: 8 }}>
              {sortedLayers.map((layer) => {
                const meta = (layer.metadata as Record<string, unknown> | null) ?? null;
                return (
                  <View
                    key={layer.id}
                    style={[styles.layerCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={styles.layerTop}>
                      <Text style={styles.layerIcon}>{LAYER_ICONS[layer.layerType] ?? "📄"}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.layerTitle, { color: colors.foreground }]}>
                          {LAYER_LABELS[layer.layerType] ?? layer.layerType}
                        </Text>
                        <Text style={[styles.layerSubtitle, { color: colors.mutedForeground }]}>
                          {layer.layerDate
                            ? new Date(layer.layerDate).toLocaleDateString(undefined, {
                                year: "numeric",
                                month: "long",
                              })
                            : "Date unknown"}
                          {layer.sourcePlatform
                            ? ` · ${PLATFORM_LABELS[layer.sourcePlatform] ?? layer.sourcePlatform}`
                            : ""}
                        </Text>
                      </View>
                    </View>
                    {meta ? (
                      <View style={styles.layerMeta}>
                        {meta.avgYieldPerAcre != null ? (
                          <MetaStat
                            label="Avg yield"
                            value={`${String(meta.avgYieldPerAcre)} bu/ac`}
                            color={colors.foreground}
                            mutedColor={colors.mutedForeground}
                          />
                        ) : null}
                        {meta.totalAppliedLbs != null ? (
                          <MetaStat
                            label="Applied"
                            value={`${formatNum(meta.totalAppliedLbs)} lbs`}
                            color={colors.foreground}
                            mutedColor={colors.mutedForeground}
                          />
                        ) : null}
                        {meta.seedsPerAcre != null ? (
                          <MetaStat
                            label="Seed rate"
                            value={`${formatNum(meta.seedsPerAcre)} /ac`}
                            color={colors.foreground}
                            mutedColor={colors.mutedForeground}
                          />
                        ) : null}
                        {meta.acres != null ? (
                          <MetaStat
                            label="Area"
                            value={`${String(meta.acres)} ac`}
                            color={colors.foreground}
                            mutedColor={colors.mutedForeground}
                          />
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
              Sampling Plans{samplingPlans && samplingPlans.length ? ` (${samplingPlans.length})` : ""}
            </Text>
            <Pressable
              onPress={() => setShowPlanForm((s) => !s)}
              style={[styles.addBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              testID="toggle-plan-form"
            >
              <Feather name={showPlanForm ? "x" : "plus"} size={14} color={colors.foreground} />
              <Text style={[styles.addBtnText, { color: colors.foreground }]}>{showPlanForm ? "Close" : "New Plan"}</Text>
            </Pressable>
          </View>
          {showPlanForm ? (
            <View style={[styles.layerCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 12 }]}>
              <SoilField
                label="Plan name"
                value={planName}
                onChangeText={setPlanName}
                placeholder={`${planSeason.trim() || "New"} Sampling`}
                colors={colors}
              />
              <SoilField label="Season" value={planSeason} onChangeText={setPlanSeason} placeholder="e.g. 2026" colors={colors} />
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Sample types
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {PLAN_SAMPLE_TYPES.map((t) => {
                    const active = planSampleTypes.includes(t);
                    return (
                      <Pressable
                        key={t}
                        onPress={() => togglePlanSampleType(t)}
                        style={[
                          styles.typeChip,
                          {
                            borderColor: active ? colors.primary : colors.border,
                            backgroundColor: active ? colors.primary : colors.background,
                          },
                        ]}
                        testID={`plan-sample-type-${t}`}
                      >
                        <Text
                          style={{
                            fontSize: 13,
                            fontFamily: "Inter_600SemiBold",
                            textTransform: "capitalize",
                            color: active ? colors.background : colors.foreground,
                          }}
                        >
                          {t}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Pressable
                onPress={submitPlan}
                disabled={createPlan.isPending}
                style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: createPlan.isPending ? 0.6 : 1 }]}
                testID="save-sampling-plan"
              >
                <Text style={[styles.saveBtnText, { color: colors.background }]}>
                  {createPlan.isPending ? "Creating…" : "Create Plan"}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {loadingPlans && !samplingPlans ? (
            <View style={{ padding: 16, alignItems: "center" }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : !samplingPlans || samplingPlans.length === 0 ? (
            <EmptyState
              icon="crosshair"
              title="No sampling plans"
              subtitle="Sampling plans created for this field will appear here."
            />
          ) : (
            <View style={{ gap: 8 }}>
              {samplingPlans.map((plan) => (
                <SamplingPlanRow key={plan.id} plan={plan} colors={colors} />
              ))}
            </View>
          )}
        </View>

        <View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Soil Test</Text>
            <Pressable
              onPress={() => setShowSoilForm((s) => !s)}
              style={[styles.addBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              testID="toggle-soil-form"
            >
              <Feather name={showSoilForm ? "x" : "plus"} size={14} color={colors.foreground} />
              <Text style={[styles.addBtnText, { color: colors.foreground }]}>{showSoilForm ? "Close" : "Add Soil Test"}</Text>
            </Pressable>
          </View>
          {showSoilForm ? (
            <View style={[styles.layerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SoilField label="Sample date (YYYY-MM-DD)" value={soilDate} onChangeText={setSoilDate} colors={colors} />
              <SoilField label="Lab" value={soilLab} onChangeText={setSoilLab} colors={colors} placeholder="e.g. AgSource" />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <SoilField label="pH" value={soilPh} onChangeText={setSoilPh} keyboardType="decimal-pad" colors={colors} />
                </View>
                <View style={{ flex: 1 }}>
                  <SoilField label="Organic matter %" value={soilOm} onChangeText={setSoilOm} keyboardType="decimal-pad" colors={colors} />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <SoilField label="Phosphorus (ppm)" value={soilP} onChangeText={setSoilP} keyboardType="decimal-pad" colors={colors} />
                </View>
                <View style={{ flex: 1 }}>
                  <SoilField label="Potassium (ppm)" value={soilK} onChangeText={setSoilK} keyboardType="decimal-pad" colors={colors} />
                </View>
              </View>
              <Pressable
                onPress={submitSoilTest}
                disabled={soilSavingState === "saving"}
                style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: soilSavingState === "saving" ? 0.6 : 1 }]}
                testID="save-soil-test"
              >
                <Text style={[styles.saveBtnText, { color: colors.background }]}>
                  {soilSavingState === "saving" ? "Saving…" : "Save Soil Test"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function SoilField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  colors,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "decimal-pad" | "numeric";
  colors: { foreground: string; mutedForeground: string; border: string; background: string };
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 11, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          color: colors.foreground,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          fontSize: 14,
        }}
      />
    </View>
  );
}

const PLAN_STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  in_progress: "In Progress",
  completed: "Completed",
  archived: "Archived",
};

function planStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return PLAN_STATUS_LABELS[status] ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function SamplingPlanRow({
  plan,
  colors,
}: {
  plan: SamplingPlan;
  colors: ReturnType<typeof useColors>;
}) {
  const counts: string[] = [];
  if (plan.zoneCount != null) counts.push(`${plan.zoneCount} ${plan.zoneCount === 1 ? "zone" : "zones"}`);
  if (plan.sampleCount != null) counts.push(`${plan.sampleCount} ${plan.sampleCount === 1 ? "sample" : "samples"}`);
  return (
    <Pressable
      onPress={() => router.push(`/sampling/${plan.id}` as never)}
      style={[styles.planRow, { backgroundColor: colors.card, borderColor: colors.border }]}
      testID={`sampling-plan-row-${plan.id}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.planTitle, { color: colors.foreground }]} numberOfLines={1}>
          {plan.name}
        </Text>
        <Text style={[styles.planSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
          {[planStatusLabel(plan.status), counts.join(" · ")].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function MetaStat({
  label,
  value,
  color,
  mutedColor,
}: {
  label: string;
  value: string;
  color: string;
  mutedColor: string;
}) {
  return (
    <View style={styles.metaStat}>
      <Text style={[styles.metaStatLabel, { color: mutedColor }]}>{label}</Text>
      <Text style={[styles.metaStatValue, { color }]}>{value}</Text>
    </View>
  );
}

function formatNum(v: unknown) {
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return n.toLocaleString();
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 10 },
  backBtn: { padding: 4 },
  titleWrap: { flex: 1 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  sectionLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  boundaryMeta: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  emptyBox: { borderWidth: 1, borderRadius: 12, padding: 20, alignItems: "center", gap: 6 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  layerCard: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 10 },
  layerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  layerIcon: { fontSize: 24 },
  layerTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  layerSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  layerMeta: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  typeChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  addBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  saveBtn: { borderRadius: 8, paddingVertical: 12, alignItems: "center", marginTop: 4 },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  metaStat: { gap: 1 },
  metaStatLabel: { fontSize: 10, fontFamily: "Inter_400Regular", textTransform: "uppercase", letterSpacing: 0.5 },
  metaStatValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  planRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1 },
  planTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  planSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
