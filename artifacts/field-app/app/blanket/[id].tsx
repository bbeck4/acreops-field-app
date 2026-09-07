import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  getGetBlanketOrderQueryKey,
  getListBlanketOrdersQueryKey,
  useGetBlanketOrder,
  useUpdateBlanketOrder,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { useAppAuth } from "@/context/AuthContext";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  active: { bg: "#dcfce7", fg: "#15803d" },
  expired: { bg: "#fee2e2", fg: "#b91c1c" },
  cancelled: { bg: "#f1f5f9", fg: "#475569" },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function tap() {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function fmtQty(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Parse a YYYY-MM-DD date string at local midnight (avoids the UTC shift that
// `new Date("YYYY-MM-DD")` introduces).
function parseDate(value: string | null | undefined): Date | null {
  if (!value || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtHuman(value: string | null | undefined): string {
  const d = parseDate(value);
  if (!d) return "Not set";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const QUICK_EXTENSIONS: { label: string; days: number }[] = [
  { label: "+30 days", days: 30 },
  { label: "+60 days", days: 60 },
  { label: "+90 days", days: 90 },
  { label: "+1 year", days: 365 },
];

export default function BlanketDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const blanketId = Number(params.id);
  const { currentMember } = useAppAuth();
  const { isOnline } = useOffline();
  const isManager =
    currentMember?.role === "manager" || currentMember?.role === "admin";

  const enabled = Number.isFinite(blanketId) && blanketId > 0;
  const { data: blanket, isLoading } = useGetBlanketOrder(blanketId, {
    query: { queryKey: getGetBlanketOrderQueryKey(blanketId), enabled },
  });

  const { mutateAsync: updateBlanket, isPending: isSaving } = useUpdateBlanketOrder();

  // The expiry the manager is about to set. Seeded from the blanket once loaded.
  const [draftExpiry, setDraftExpiry] = useState("");
  useEffect(() => {
    if (blanket?.expiresAt) setDraftExpiry(blanket.expiresAt);
  }, [blanket?.expiresAt]);

  const status = (blanket?.status ?? "").toLowerCase();
  const statusStyle = STATUS_COLORS[status] ?? STATUS_COLORS.cancelled;

  const draftValid = DATE_RE.test(draftExpiry) && parseDate(draftExpiry) !== null;
  const changed = !!blanket && draftExpiry !== (blanket.expiresAt ?? "");
  // Re-activating only matters when the blanket already lapsed and the manager
  // is pushing the date into the future.
  const willReactivate = useMemo(() => {
    if (status !== "expired" || !draftValid) return false;
    const d = parseDate(draftExpiry);
    if (!d) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d.getTime() >= today.getTime();
  }, [status, draftValid, draftExpiry]);

  const applyQuick = (days: number) => {
    tap();
    // Extend from the later of today or the current expiry, so a quick "+30
    // days" on an already-lapsed blanket still lands in the future.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const current = parseDate(draftExpiry) ?? parseDate(blanket?.expiresAt);
    const base = current && current.getTime() > today.getTime() ? current : today;
    setDraftExpiry(toIsoDate(addDays(base, days)));
  };

  const save = async () => {
    if (!blanket || !draftValid || isSaving) return;
    tap();
    try {
      await updateBlanket({
        id: blanket.id,
        data: {
          expiresAt: draftExpiry,
          ...(willReactivate ? { status: "active" as const } : {}),
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetBlanketOrderQueryKey(blanket.id),
      });
      await queryClient.invalidateQueries({ queryKey: getListBlanketOrdersQueryKey() });
      Alert.alert(
        "Expiry updated",
        willReactivate
          ? `Blanket ${blanket.blanketNumber} is active again through ${fmtHuman(draftExpiry)}.`
          : `Blanket ${blanket.blanketNumber} now expires ${fmtHuman(draftExpiry)}.`,
      );
    } catch {
      Alert.alert(
        "Couldn't update the blanket",
        "Please try again when you have a stable connection.",
      );
    }
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
          {blanket ? `Blanket ${blanket.blanketNumber}` : "Blanket"}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading && !blanket ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !blanket ? (
        <View style={styles.center}>
          <EmptyState
            icon="file-text"
            title="Blanket not found"
            subtitle="It may have been removed or you don't have access to it."
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.cardHeader}>
              <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
                {blanket.productName ?? "Blanket order"}
              </Text>
              <View style={[styles.badge, { backgroundColor: statusStyle.bg }]}>
                <Text style={[styles.badgeText, { color: statusStyle.fg }]}>{status}</Text>
              </View>
            </View>
            {blanket.vendorName ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {blanket.vendorName}
              </Text>
            ) : null}

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                  Committed
                </Text>
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {fmtQty(blanket.qtyCommitted)}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Used</Text>
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {fmtQty(blanket.qtyUsed)}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                  Remaining
                </Text>
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {fmtQty(blanket.qtyRemaining)}
                </Text>
              </View>
            </View>
          </View>

          <View
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              Current expiry
            </Text>
            <Text style={[styles.expiryValue, { color: colors.foreground }]}>
              {fmtHuman(blanket.expiresAt)}
            </Text>

            {!isManager ? (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                Only managers can change a blanket's expiry.
              </Text>
            ) : !isOnline ? (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                Reconnect to extend this blanket's expiry.
              </Text>
            ) : (
              <>
                <Text
                  style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 18 }]}
                >
                  Extend expiry
                </Text>
                <View style={styles.quickRow}>
                  {QUICK_EXTENSIONS.map((q) => (
                    <Pressable
                      key={q.label}
                      onPress={() => applyQuick(q.days)}
                      style={[styles.quickBtn, { borderColor: colors.border }]}
                      hitSlop={6}
                    >
                      <Text style={[styles.quickBtnText, { color: colors.primary }]}>
                        {q.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text
                  style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}
                >
                  New expiry date
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      borderColor: draftValid ? colors.border : colors.destructive,
                      color: colors.foreground,
                    },
                  ]}
                  value={draftExpiry}
                  onChangeText={setDraftExpiry}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                />
                {!draftValid && draftExpiry.length > 0 ? (
                  <Text style={[styles.note, { color: colors.destructive }]}>
                    Enter a date as YYYY-MM-DD.
                  </Text>
                ) : null}
                {willReactivate ? (
                  <Text style={[styles.note, { color: colors.mutedForeground }]}>
                    This blanket has lapsed — saving will reactivate it.
                  </Text>
                ) : null}

                <Pressable
                  onPress={save}
                  disabled={!draftValid || !changed || isSaving}
                  style={[
                    styles.saveBtn,
                    {
                      backgroundColor:
                        !draftValid || !changed || isSaving
                          ? colors.muted
                          : colors.primary,
                    },
                  ]}
                >
                  {isSaving ? (
                    <ActivityIndicator color={colors.primaryForeground} size="small" />
                  ) : (
                    <Text
                      style={[styles.saveBtnText, { color: colors.primaryForeground }]}
                    >
                      {willReactivate ? "Reactivate & save" : "Save new expiry"}
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  title: { flex: 1, paddingRight: 8, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  statsRow: { flexDirection: "row", marginTop: 16, gap: 12 },
  stat: { flex: 1 },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statValue: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  expiryValue: { fontSize: 20, fontFamily: "Inter_700Bold", marginTop: 4 },
  note: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 8 },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  quickBtn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  quickBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  saveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
