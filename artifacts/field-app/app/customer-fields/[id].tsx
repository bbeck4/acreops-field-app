import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AgField, useGetCustomer, useListCustomerFields, useListFieldLayers } from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
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

function platformLabel(p: string) {
  return (
    {
      jd_operations_center: "John Deere",
      ag_leader: "Ag Leader",
      climate_fieldview: "FieldView",
    }[p] ?? p
  );
}

export default function CustomerFieldsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const customerId = parseInt(id ?? "0", 10);

  const { data: customer } = useGetCustomer(customerId);
  const { data: fields, isLoading } = useListCustomerFields(customerId);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

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
            Fields
          </Text>
          {customer ? (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              {customer.name}
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100, gap: 10 }}>
        {isLoading && !fields ? (
          <View style={{ padding: 32, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !fields || fields.length === 0 ? (
          <EmptyState
            icon="map"
            title="No fields synced"
            subtitle="Fields imported from John Deere, Ag Leader, or Climate FieldView will appear here."
          />
        ) : (
          fields.map((f) => <FieldRow key={f.id} field={f} />)
        )}
      </ScrollView>
    </View>
  );
}

function FieldRow({ field }: { field: AgField }) {
  const colors = useColors();
  const { data: layers } = useListFieldLayers(field.id);

  const latest = React.useMemo(() => {
    if (!layers || layers.length === 0) return null;
    return [...layers].sort((a, b) => {
      const ad = a.layerDate ? new Date(a.layerDate).getTime() : 0;
      const bd = b.layerDate ? new Date(b.layerDate).getTime() : 0;
      return bd - ad;
    })[0];
  }, [layers]);

  const summary = latest ? layerSummary(latest) : null;

  return (
    <Pressable
      onPress={() => router.push(`/ag-field/${field.id}` as never)}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      testID={`field-row-${field.id}`}
    >
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.fieldName, { color: colors.foreground }]} numberOfLines={1}>
            {field.name}
          </Text>
          {field.farmName ? (
            <Text style={[styles.farmName, { color: colors.mutedForeground }]} numberOfLines={1}>
              {field.farmName}
            </Text>
          ) : null}
        </View>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </View>
      <View style={styles.metaRow}>
        {field.acres != null ? (
          <View style={[styles.chip, { backgroundColor: colors.accent }]}>
            <Feather name="square" size={11} color={colors.primary} />
            <Text style={[styles.chipText, { color: colors.primary }]}>{field.acres.toFixed(1)} ac</Text>
          </View>
        ) : null}
        {field.cropPlan ? (
          <View style={[styles.chip, { backgroundColor: colors.muted }]}>
            <Feather name="feather" size={11} color={colors.mutedForeground} />
            <Text style={[styles.chipText, { color: colors.mutedForeground }]}>{field.cropPlan}</Text>
          </View>
        ) : null}
        {field.sourcePlatform ? (
          <View style={[styles.chip, { backgroundColor: colors.muted }]}>
            <Text style={[styles.chipText, { color: colors.mutedForeground }]}>
              {platformLabel(field.sourcePlatform)}
            </Text>
          </View>
        ) : null}
      </View>
      {latest ? (
        <View style={[styles.layerRow, { borderTopColor: colors.border }]} testID={`field-latest-layer-${field.id}`}>
          <Text style={styles.layerIcon}>{LAYER_ICONS[latest.layerType] ?? "📄"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.layerLabel, { color: colors.foreground }]} numberOfLines={1}>
              Latest: {LAYER_LABELS[latest.layerType] ?? latest.layerType}
              {latest.layerDate
                ? ` · ${new Date(latest.layerDate).toLocaleDateString(undefined, { year: "numeric", month: "short" })}`
                : ""}
            </Text>
            {summary ? (
              <Text style={[styles.layerSummary, { color: colors.mutedForeground }]} numberOfLines={1}>
                {summary}
              </Text>
            ) : null}
          </View>
        </View>
      ) : layers && layers.length === 0 ? (
        <View style={[styles.layerRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.layerSummary, { color: colors.mutedForeground }]}>No layers synced yet</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function layerSummary(layer: { metadata?: unknown }) {
  const meta = (layer.metadata as Record<string, unknown> | null) ?? null;
  if (!meta) return null;
  const parts: string[] = [];
  if (meta.avgYieldPerAcre != null) parts.push(`${String(meta.avgYieldPerAcre)} bu/ac avg`);
  if (meta.totalAppliedLbs != null) parts.push(`${Number(meta.totalAppliedLbs).toLocaleString()} lbs applied`);
  if (meta.seedsPerAcre != null) parts.push(`${Number(meta.seedsPerAcre).toLocaleString()} seeds/ac`);
  if (parts.length === 0 && meta.acres != null) parts.push(`${String(meta.acres)} ac`);
  return parts.join(" · ") || null;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 10 },
  backBtn: { padding: 4 },
  titleWrap: { flex: 1 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 8 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  fieldName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  farmName: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  chipText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  layerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, borderTopWidth: 1 },
  layerIcon: { fontSize: 20 },
  layerLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  layerSummary: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
