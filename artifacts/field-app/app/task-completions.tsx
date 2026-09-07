import { Feather } from "@expo/vector-icons";
import { useListCustomers } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

type TaskIncentive = {
  id: number;
  planId: number;
  label: string | null;
  flatBonusCents: number | null;
};

type TaskCompletion = {
  id: number;
  planIncentiveId: number;
  taskLabel: string | null;
  flatBonusCents: number | null;
  customerName: string | null;
  notes: string | null;
  status: "submitted" | "approved" | "rejected";
  rejectionReason: string | null;
  reviewedAt: string | null;
  submittedAt: string;
};

function formatCents(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  submitted: { bg: "#fef3c7", text: "#92400e" },
  approved: { bg: "#dcfce7", text: "#15803d" },
  rejected: { bg: "#fee2e2", text: "#b91c1c" },
};

export default function TaskCompletionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentMember } = useAppAuth();

  const [incentives, setIncentives] = useState<TaskIncentive[]>([]);
  const [completions, setCompletions] = useState<TaskCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [selectedIncentive, setSelectedIncentive] = useState<TaskIncentive | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showIncentivePicker, setShowIncentivePicker] = useState(false);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [customerFilter, setCustomerFilter] = useState("");

  const { data: customers } = useListCustomers();
  const selectedCustomer = customers?.find((c) => c.id === selectedCustomerId) ?? null;
  const filteredCustomers = useMemo(() => {
    const q = customerFilter.trim().toLowerCase();
    return (customers ?? [])
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [customers, customerFilter]);

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const baseUrl = `https://${domain}/api`;

  const loadData = useCallback(async () => {
    try {
      const [compRes, planRes] = await Promise.all([
        fetch(`${baseUrl}/task-completions`, { credentials: "include" }),
        currentMember?.planId
          ? fetch(`${baseUrl}/compensation-plans/${currentMember.planId}`, { credentials: "include" })
          : Promise.resolve(null),
      ]);

      if (compRes.ok) {
        const data: TaskCompletion[] = await compRes.json();
        setCompletions(data);
      }

      if (planRes?.ok) {
        const plan = await planRes.json();
        const taskIncentives: TaskIncentive[] = (plan.incentives ?? [])
          .filter((i: { targetType: string }) => i.targetType === "task")
          .map((i: { id: number; planId: number; label: string | null; flatBonusCents: number | null }) => ({
            id: i.id,
            planId: i.planId,
            label: i.label,
            flatBonusCents: i.flatBonusCents,
          }));
        setIncentives(taskIncentives);
      }
    } catch {
      // Silent — show stale data.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [baseUrl, currentMember?.planId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const resetForm = () => {
    setSelectedIncentive(null);
    setSelectedCustomerId(null);
    setCustomerFilter("");
    setNotes("");
    setSubmitting(false);
  };

  const submitCompletion = async () => {
    if (!selectedIncentive || submitting) return;
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`${baseUrl}/task-completions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planIncentiveId: selectedIncentive.id,
          customerId: selectedCustomerId ?? undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        Alert.alert("Error", err.error ?? "Could not submit. Please try again.");
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowForm(false);
      resetForm();
      loadData();
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  const renderCompletion = ({ item }: { item: TaskCompletion }) => {
    const palette = STATUS_COLORS[item.status] ?? STATUS_COLORS.submitted;
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.taskLabel, { color: colors.foreground }]} numberOfLines={2}>
              {item.taskLabel ?? `Task #${item.planIncentiveId}`}
            </Text>
            {item.notes ? (
              <Text style={[styles.notes, { color: colors.mutedForeground }]} numberOfLines={2}>
                {item.notes}
              </Text>
            ) : null}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: palette.bg }]}>
            <Text style={[styles.statusText, { color: palette.text }]}>{item.status}</Text>
          </View>
        </View>

        <View style={styles.cardMeta}>
          {item.flatBonusCents != null && (
            <Text style={[styles.metaItem, { color: colors.primary }]}>
              {formatCents(item.flatBonusCents)}
            </Text>
          )}
          <Text style={[styles.metaItem, { color: colors.mutedForeground }]}>
            Submitted {formatDate(item.submittedAt)}
          </Text>
          {item.status === "approved" && item.reviewedAt && (
            <Text style={[styles.metaItem, { color: "#15803d" }]}>
              ✓ Approved {formatDate(item.reviewedAt)}
            </Text>
          )}
          {item.status === "rejected" && item.rejectionReason && (
            <Text style={[styles.metaItem, { color: "#b91c1c" }]}>
              ✕ {item.rejectionReason}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: "Task Completions" }} />

      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Task Completions</Text>
        {incentives.length > 0 ? (
          <Pressable
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setShowForm(true);
            }}
          >
            <Feather name="plus" size={18} color="#fff" />
          </Pressable>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={completions}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshing={refreshing}
          onRefresh={onRefresh}
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="check-square" size={40} color={colors.mutedForeground} style={{ marginBottom: 12 }} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No submissions yet</Text>
              <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
                {incentives.length > 0
                  ? 'Tap + to log a completed task for manager review.'
                  : 'No task incentives are set up on your compensation plan.'}
              </Text>
            </View>
          }
          renderItem={renderCompletion}
        />
      )}

      {/* Submit form bottom sheet */}
      {showForm && (
        <Pressable
          style={styles.overlay}
          onPress={() => { setShowForm(false); resetForm(); }}
        >
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => {}}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.muted }]} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Log Task Completion</Text>
              <Pressable onPress={() => { setShowForm(false); resetForm(); }}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Task</Text>
            <Pressable
              style={[styles.pickerRow, { backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={() => setShowIncentivePicker(true)}
            >
              <Feather name="check-square" size={15} color={colors.mutedForeground} />
              <Text style={[styles.pickerText, { color: selectedIncentive ? colors.foreground : colors.mutedForeground }]}>
                {selectedIncentive ? (selectedIncentive.label ?? `Task #${selectedIncentive.id}`) : "Select task…"}
              </Text>
              <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
            </Pressable>

            {selectedIncentive?.flatBonusCents != null && (
              <Text style={[styles.payoutHint, { color: colors.primary }]}>
                Payout on approval: {formatCents(selectedIncentive.flatBonusCents)}
              </Text>
            )}

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Customer (optional)</Text>
            <Pressable
              style={[styles.pickerRow, { backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={() => { setCustomerFilter(""); setShowCustomerPicker(true); }}
            >
              <Feather name="user" size={15} color={colors.mutedForeground} />
              <Text style={[styles.pickerText, { color: selectedCustomer ? colors.foreground : colors.mutedForeground }]}>
                {selectedCustomer ? selectedCustomer.name : "Link a customer…"}
              </Text>
              {selectedCustomer ? (
                <Pressable onPress={() => setSelectedCustomerId(null)} hitSlop={8}>
                  <Feather name="x" size={15} color={colors.mutedForeground} />
                </Pressable>
              ) : (
                <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
              )}
            </Pressable>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Notes (optional)</Text>
            <TextInput
              style={[
                styles.input,
                styles.textarea,
                { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
              ]}
              placeholder="Add context for your manager…"
              placeholderTextColor={colors.mutedForeground}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />

            <View style={styles.formActions}>
              <Pressable
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                onPress={() => { setShowForm(false); resetForm(); }}
              >
                <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: !selectedIncentive || submitting ? 0.5 : 1 }]}
                onPress={submitCompletion}
                disabled={!selectedIncentive || submitting}
              >
                <Text style={styles.submitText}>{submitting ? "Submitting…" : "Submit"}</Text>
              </Pressable>
            </View>
            <View style={{ height: insets.bottom }} />
          </Pressable>
        </Pressable>
      )}

      {/* Incentive picker modal */}
      <Modal
        visible={showIncentivePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowIncentivePicker(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setShowIncentivePicker(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.muted }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground, marginBottom: 8 }]}>Select Task</Text>
            <ScrollView>
              {incentives.map((inc) => (
                <Pressable
                  key={inc.id}
                  style={[
                    styles.memberOption,
                    {
                      borderColor: colors.border,
                      backgroundColor: selectedIncentive?.id === inc.id ? colors.accent : "transparent",
                    },
                  ]}
                  onPress={() => {
                    setSelectedIncentive(inc);
                    setShowIncentivePicker(false);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}>
                      {inc.label ?? `Task #${inc.id}`}
                    </Text>
                    {inc.flatBonusCents != null && (
                      <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" }}>
                        {formatCents(inc.flatBonusCents)} on approval
                      </Text>
                    )}
                  </View>
                  {selectedIncentive?.id === inc.id && (
                    <Feather name="check" size={16} color={colors.primary} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
            <View style={{ height: insets.bottom + 8 }} />
          </View>
        </Pressable>
      </Modal>

      {/* Customer picker modal */}
      <Modal
        visible={showCustomerPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCustomerPicker(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setShowCustomerPicker(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => {}}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.muted }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground, marginBottom: 8 }]}>Select Customer</Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
              ]}
              placeholder="Search customers…"
              placeholderTextColor={colors.mutedForeground}
              value={customerFilter}
              onChangeText={setCustomerFilter}
              autoCorrect={false}
            />
            <ScrollView keyboardShouldPersistTaps="handled">
              {filteredCustomers.map((c) => (
                <Pressable
                  key={c.id}
                  style={[
                    styles.memberOption,
                    {
                      borderColor: colors.border,
                      backgroundColor: selectedCustomerId === c.id ? colors.accent : "transparent",
                    },
                  ]}
                  onPress={() => {
                    setSelectedCustomerId(c.id);
                    setShowCustomerPicker(false);
                  }}
                >
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", flex: 1 }}>
                    {c.name}
                  </Text>
                  {selectedCustomerId === c.id && (
                    <Feather name="check" size={16} color={colors.primary} />
                  )}
                </Pressable>
              ))}
              {filteredCustomers.length === 0 && (
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", padding: 12 }}>
                  No customers found.
                </Text>
              )}
            </ScrollView>
            <View style={{ height: insets.bottom + 8 }} />
          </Pressable>
        </Pressable>
      </Modal>
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
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 6, textAlign: "center" },
  emptySubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  taskLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  notes: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metaItem: { fontSize: 12, fontFamily: "Inter_400Regular" },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 8,
    maxHeight: "80%",
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sheetTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6, marginTop: 8 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  pickerText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  payoutHint: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginBottom: 8,
  },
  textarea: { height: 72, textAlignVertical: "top" },
  formActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  submitBtn: {
    flex: 2,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  memberOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderBottomWidth: 1,
  },
});
