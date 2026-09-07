import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
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

import { useGetAgRecommendation } from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

type ExportFormat = "pdf" | "csv";

export default function RecommendationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const recId = parseInt(id ?? "0", 10);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const { data: rec, isLoading, error } = useGetAgRecommendation(recId);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const isAccepted = rec?.status === "accepted";

  async function handleExport(format: ExportFormat) {
    if (!recId || exporting) return;
    if (!isAccepted) {
      Alert.alert("Not exportable", "Only accepted recommendations can be exported.");
      return;
    }
    setExporting(format);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (!domain) throw new Error("API domain not configured");
      const url = `https://${domain}/api/ag-recommendations/${recId}/export?format=${format}`;
      const token = await getToken();
      const safeName = (rec?.fieldName ?? `rec${recId}`).replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeSeason = (rec?.season ?? "export").replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `prescription_${safeName}_${safeSeason}.${format}`;
      const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!baseDir) throw new Error("No writable directory available");
      const fileUri = `${baseDir}${filename}`;

      const result = await FileSystem.downloadAsync(url, fileUri, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (result.status !== 200) {
        throw new Error(`Server returned status ${result.status}`);
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(result.uri, {
          mimeType: format === "pdf" ? "application/pdf" : "text/csv",
          dialogTitle: `Share ${format.toUpperCase()} prescription`,
          UTI: format === "pdf" ? "com.adobe.pdf" : "public.comma-separated-values-text",
        });
      } else {
        Alert.alert("Saved", `File saved to ${result.uri}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      Alert.alert("Export failed", msg);
    } finally {
      setExporting(null);
    }
  }

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: "Recommendation" }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !rec) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: "Recommendation" }} />
        <Feather name="alert-circle" size={32} color={colors.mutedForeground} />
        <Text style={[styles.errorText, { color: colors.foreground }]}>Couldn't load recommendation</Text>
      </View>
    );
  }

  const yieldLine = rec.yieldGoal != null
    ? `${rec.yieldGoal} ${rec.yieldGoalUnit ?? "bu/ac"}`
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <Stack.Screen options={{ title: "Recommendation" }} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            {rec.fieldName ?? `Field #${rec.fieldId}`}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            {rec.cropTarget ?? "Recommendation"}{rec.season ? ` · ${rec.season}` : ""}
          </Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: isAccepted ? colors.accent : colors.muted }]}>
          <Text style={[styles.statusText, { color: isAccepted ? colors.primary : colors.mutedForeground }]}>
            {rec.status}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}>
        {/* Summary card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Overview</Text>
          <InfoRow label="Field" value={rec.fieldName ?? "—"} colors={colors} />
          <InfoRow label="Crop" value={rec.cropTarget ?? "—"} colors={colors} />
          {yieldLine ? <InfoRow label="Yield goal" value={yieldLine} colors={colors} /> : null}
          {rec.season ? <InfoRow label="Season" value={rec.season} colors={colors} /> : null}
          {rec.reviewedAt ? (
            <InfoRow
              label="Reviewed"
              value={new Date(rec.reviewedAt).toLocaleDateString()}
              colors={colors}
            />
          ) : null}
        </View>

        {/* Fertilizer program */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Fertilizer Program</Text>
          {rec.items.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No line items</Text>
          ) : (
            rec.items.map((item, idx) => (
              <View
                key={item.id}
                style={[
                  styles.itemRow,
                  idx < rec.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                ]}
              >
                <Text style={[styles.itemName, { color: colors.foreground }]}>{item.productName}</Text>
                <View style={styles.itemMetaRow}>
                  {item.rate != null ? (
                    <Text style={[styles.itemMeta, { color: colors.foreground }]}>
                      {item.rate} {item.rateUnit ?? ""}
                    </Text>
                  ) : null}
                  {item.timing ? (
                    <Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>· {item.timing}</Text>
                  ) : null}
                  {item.applicationMethod ? (
                    <Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>· {item.applicationMethod}</Text>
                  ) : null}
                </View>
                {item.rationale ? (
                  <Text style={[styles.rationale, { color: colors.mutedForeground }]}>{item.rationale}</Text>
                ) : null}
              </View>
            ))
          )}
        </View>

        {/* Export actions */}
        {isAccepted ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Share or save</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                style={[
                  styles.exportBtn,
                  { backgroundColor: colors.primary, opacity: exporting ? 0.6 : 1 },
                ]}
                disabled={!!exporting}
                onPress={() => handleExport("pdf")}
                testID="export-pdf-btn"
              >
                {exporting === "pdf" ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Feather name="file-text" size={16} color="#fff" />
                )}
                <Text style={styles.exportBtnText}>
                  {exporting === "pdf" ? "Preparing…" : "Export PDF"}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.exportBtnSecondary,
                  { borderColor: colors.primary, opacity: exporting ? 0.6 : 1 },
                ]}
                disabled={!!exporting}
                onPress={() => handleExport("csv")}
                testID="export-csv-btn"
              >
                {exporting === "csv" ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Feather name="grid" size={16} color={colors.primary} />
                )}
                <Text style={[styles.exportBtnTextSecondary, { color: colors.primary }]}>
                  {exporting === "csv" ? "Preparing…" : "Export CSV"}
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
              {Platform.OS === "ios"
                ? "Opens the share sheet so you can email, AirDrop, or save to Files."
                : "Opens the share sheet so you can email, message, or save the file."}
            </Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
              Only accepted recommendations can be exported. Accept this recommendation on the web platform first.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  errorText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  headerSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  infoValue: { fontSize: 13, fontFamily: "Inter_500Medium", flexShrink: 1, textAlign: "right" },
  itemRow: { paddingVertical: 10, gap: 4 },
  itemName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  itemMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  itemMeta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  rationale: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4, lineHeight: 16 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 8 },
  exportBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
  },
  exportBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  exportBtnSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1.5,
    backgroundColor: "transparent",
  },
  exportBtnTextSecondary: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  helperText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },
});
