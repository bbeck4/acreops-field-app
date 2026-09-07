import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  ScrollView,
} from "react-native";
import {
  useListCustomerWorkOrders,
  useCreateWorkOrder,
  getListCustomerWorkOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useOffline } from "@/context/OfflineContext";

const ACTIVE_WO_STATUSES = new Set(["draft", "submitted", "scheduled"]);

type Phase = "idle" | "running" | "review" | "saving" | "done" | "error";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  customerId: number;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function TimeRecorder({ customerId, visible, onClose, onSaved }: Props) {
  const colors = useColors();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { data: allWorkOrders } = useListCustomerWorkOrders(customerId);
  const workOrders = (allWorkOrders ?? []).filter((w) => ACTIVE_WO_STATUSES.has(w.status));
  const { mutateAsync: createWorkOrder, isPending: creatingWO } = useCreateWorkOrder();
  const { isOnline, queueWrite } = useOffline();
  const [woFormOpen, setWoFormOpen] = useState(false);
  const [newWoNotes, setNewWoNotes] = useState("");
  const [newWoDelivery, setNewWoDelivery] = useState("");
  const [newWoError, setNewWoError] = useState<string | null>(null);
  const [newWoCreatedHint, setNewWoCreatedHint] = useState<string | null>(null);

  const handleCreateWorkOrder = useCallback(async () => {
    setNewWoError(null);
    const trimmedDate = newWoDelivery.trim();
    if (trimmedDate && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      setNewWoError("Delivery date must look like 2026-05-30");
      return;
    }
    try {
      const created = await createWorkOrder({
        data: {
          customerId,
          status: "draft",
          notes: newWoNotes.trim() || undefined,
          deliveryDate: trimmedDate || undefined,
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await queryClient.invalidateQueries({
        queryKey: getListCustomerWorkOrdersQueryKey(customerId),
      });
      setWorkOrderId(created.id);
      setNewWoCreatedHint(`Draft WO ${created.orderNumber} created — open it in the Orders tab to add line items.`);
      setNewWoNotes("");
      setNewWoDelivery("");
      setWoFormOpen(false);
      setPickerOpen(false);
    } catch (e) {
      setNewWoError(e instanceof Error ? e.message : "Could not create work order");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [createWorkOrder, customerId, newWoDelivery, newWoNotes, queryClient]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number>(0);
  const [pausedElapsed, setPausedElapsed] = useState<number>(0);
  const [, setTick] = useState(0);
  const [billable, setBillable] = useState(true);
  const [notes, setNotes] = useState("");
  const [workOrderId, setWorkOrderId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manualMinutes, setManualMinutes] = useState<string>("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setStartedAt(0);
    setPausedElapsed(0);
    setBillable(true);
    setNotes("");
    setWorkOrderId(null);
    setManualMinutes("");
    setPickerOpen(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  useEffect(() => {
    if (phase === "running") {
      intervalRef.current = setInterval(() => setTick((t) => t + 1), 1000);
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
  }, [phase]);

  const elapsedMs = phase === "running" ? Date.now() - startedAt : pausedElapsed;
  const minutes = Math.max(1, Math.round(elapsedMs / 60000));

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const startTimer = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStartedAt(Date.now());
    setPhase("running");
  }, []);

  const stopTimer = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const ms = Date.now() - startedAt;
    setPausedElapsed(ms);
    setManualMinutes(String(Math.max(1, Math.round(ms / 60000))));
    setPhase("review");
  }, [startedAt]);

  const startManual = useCallback(() => {
    setPausedElapsed(0);
    setManualMinutes("");
    setPhase("review");
  }, []);

  const save = useCallback(async () => {
    setPhase("saving");
    setError(null);
    const mins = parseInt(manualMinutes, 10);
    if (!Number.isFinite(mins) || mins <= 0) {
      setError("Enter a duration of at least 1 minute.");
      setPhase("error");
      return;
    }
    const wo = workOrderId ? workOrders?.find((w) => w.id === workOrderId) : null;
    const subject = wo
      ? `${mins} min on WO ${wo.orderNumber}`
      : `${mins} min on site`;
    const payload = {
      customerId,
      type: "time" as const,
      subtype: billable ? "billable_time" : "time",
      subject,
      notes: notes.trim() || null,
      durationMinutes: mins,
      billable,
      workOrderId: workOrderId ?? null,
    };

    const enqueue = async () => {
      await queueWrite("activity", payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setPhase("done");
      onSaved();
    };

    if (!isOnline) {
      try {
        await enqueue();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
        setPhase("error");
      }
      return;
    }

    try {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (!domain) throw new Error("API domain not configured");
      const token = await getToken();
      if (!token) throw new Error("Not signed in");

      const res = await fetch(`https://${domain}/api/activities`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Save failed (${res.status}): ${body || res.statusText}`);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhase("done");
      onSaved();
    } catch (e) {
      try {
        await enqueue();
      } catch {
        setError(e instanceof Error ? e.message : "Save failed");
        setPhase("error");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }
  }, [billable, customerId, getToken, isOnline, manualMinutes, notes, onSaved, queueWrite, workOrderId, workOrders]);

  const accent = "#f59e0b";
  const selectedWO = workOrderId ? workOrders?.find((w) => w.id === workOrderId) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>Record time</Text>
            <Pressable onPress={handleClose} hitSlop={8} testID="time-close">
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {phase === "idle" || phase === "running" ? (
            <View style={styles.center}>
              <View style={[styles.clockCircle, { backgroundColor: accent }]}>
                <Feather name="clock" size={36} color="#fff" />
              </View>
              <Text style={[styles.elapsed, { color: colors.foreground }]}>
                {formatElapsed(elapsedMs)}
              </Text>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                {phase === "running"
                  ? "Timer running — tap stop when finished"
                  : "Start the timer when you arrive on site"}
              </Text>
              <View style={styles.actions}>
                {phase === "idle" ? (
                  <>
                    <Pressable
                      style={[styles.secondaryBtn, { borderColor: colors.border }]}
                      onPress={startManual}
                      testID="time-manual"
                    >
                      <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>
                        Enter manually
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.primaryBtn, { backgroundColor: accent }]}
                      onPress={startTimer}
                      testID="time-start"
                    >
                      <Feather name="play" size={14} color="#fff" />
                      <Text style={styles.primaryBtnText}>Start timer</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    style={[styles.primaryBtn, { backgroundColor: "#ef4444" }]}
                    onPress={stopTimer}
                    testID="time-stop"
                  >
                    <Feather name="square" size={14} color="#fff" />
                    <Text style={styles.primaryBtnText}>Stop</Text>
                  </Pressable>
                )}
              </View>
            </View>
          ) : null}

          {phase === "review" ? (
            <ScrollView style={{ maxHeight: 480 }}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Minutes</Text>
                <TextInput
                  value={manualMinutes}
                  onChangeText={setManualMinutes}
                  keyboardType="number-pad"
                  placeholder="e.g. 45"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    styles.input,
                    { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
                  ]}
                  testID="time-minutes"
                />
              </View>

              {newWoCreatedHint ? (
                <View
                  style={{
                    backgroundColor: "#fef3c7",
                    borderColor: "#fde68a",
                    borderWidth: 1,
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 10,
                    flexDirection: "row",
                    gap: 8,
                  }}
                >
                  <Feather name="info" size={14} color="#b45309" style={{ marginTop: 2 }} />
                  <Text style={{ color: "#92400e", fontSize: 12, flex: 1, lineHeight: 17 }}>
                    {newWoCreatedHint}
                  </Text>
                </View>
              ) : null}

              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Work order (optional)</Text>
                <Pressable
                  style={[
                    styles.input,
                    styles.pickerBtn,
                    { borderColor: colors.border, backgroundColor: colors.background },
                  ]}
                  onPress={() => setPickerOpen(true)}
                  testID="time-wo-picker"
                >
                  <Text style={{ color: selectedWO ? colors.foreground : colors.mutedForeground, flex: 1 }}>
                    {selectedWO ? `WO ${selectedWO.orderNumber}` : "None — log to customer only"}
                  </Text>
                  <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>

              <View style={[styles.field, styles.switchRow]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: colors.foreground, marginBottom: 2 }]}>Billable</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {billable
                      ? selectedWO
                        ? "Will be flagged on the work order for billing"
                        : "Marked billable; attach a work order to bill it"
                      : "Logged for tracking only"}
                  </Text>
                </View>
                <Switch value={billable} onValueChange={setBillable} testID="time-billable" />
              </View>

              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Notes (optional)</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="What did you work on?"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  style={[
                    styles.input,
                    { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, minHeight: 70, textAlignVertical: "top" },
                  ]}
                  testID="time-notes"
                />
              </View>

              <View style={[styles.actions, { justifyContent: "flex-end" }]}>
                <Pressable
                  style={[styles.secondaryBtn, { borderColor: colors.border }]}
                  onPress={handleClose}
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: accent }]}
                  onPress={save}
                  testID="time-save"
                >
                  <Feather name="check" size={14} color="#fff" />
                  <Text style={styles.primaryBtnText}>Save time</Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : null}

          {phase === "saving" ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={accent} />
              <Text style={[styles.elapsed, { color: colors.foreground, marginTop: 16 }]}>Saving…</Text>
            </View>
          ) : null}

          {phase === "done" ? (
            <View style={styles.center}>
              <View style={[styles.successIcon, { backgroundColor: colors.accent }]}>
                <Feather name="check" size={28} color={accent} />
              </View>
              <Text style={[styles.elapsed, { color: colors.foreground, fontSize: 16 }]}>
                Time saved
              </Text>
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: accent, marginTop: 12 }]}
                onPress={handleClose}
              >
                <Text style={styles.primaryBtnText}>Done</Text>
              </Pressable>
            </View>
          ) : null}

          {phase === "error" ? (
            <View style={styles.center}>
              <Feather name="alert-circle" size={32} color="#ef4444" />
              <Text style={[styles.errorText, { color: colors.foreground }]}>
                {error ?? "Something went wrong"}
              </Text>
              <View style={styles.actions}>
                <Pressable
                  style={[styles.secondaryBtn, { borderColor: colors.border }]}
                  onPress={handleClose}
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>
                    Close
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: accent }]}
                  onPress={() => setPhase("review")}
                >
                  <Text style={styles.primaryBtnText}>Try again</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {pickerOpen ? (
          <Modal transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
            <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
              <Pressable
                onPress={(e) => e.stopPropagation()}
                style={[styles.pickerSheet, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {woFormOpen ? "New work order" : "Pick work order"}
                  </Text>
                  <Pressable
                    onPress={() => {
                      if (woFormOpen) {
                        setWoFormOpen(false);
                        setNewWoError(null);
                      } else {
                        setPickerOpen(false);
                      }
                    }}
                    hitSlop={8}
                  >
                    <Feather name="x" size={20} color={colors.mutedForeground} />
                  </Pressable>
                </View>

                {woFormOpen ? (
                  <ScrollView style={{ maxHeight: 380 }}>
                    <View style={styles.field}>
                      <Text style={[styles.label, { color: colors.mutedForeground }]}>
                        Notes (optional)
                      </Text>
                      <TextInput
                        value={newWoNotes}
                        onChangeText={setNewWoNotes}
                        placeholder="What's this order for?"
                        placeholderTextColor={colors.mutedForeground}
                        multiline
                        style={[
                          styles.input,
                          {
                            color: colors.foreground,
                            borderColor: colors.border,
                            backgroundColor: colors.background,
                            minHeight: 70,
                            textAlignVertical: "top",
                          },
                        ]}
                        testID="newwo-notes"
                      />
                    </View>
                    <View style={styles.field}>
                      <Text style={[styles.label, { color: colors.mutedForeground }]}>
                        Delivery date (optional)
                      </Text>
                      <TextInput
                        value={newWoDelivery}
                        onChangeText={setNewWoDelivery}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={colors.mutedForeground}
                        autoCapitalize="none"
                        style={[
                          styles.input,
                          {
                            color: colors.foreground,
                            borderColor: colors.border,
                            backgroundColor: colors.background,
                          },
                        ]}
                        testID="newwo-delivery"
                      />
                    </View>
                    {newWoError ? (
                      <Text
                        style={{ color: "#ef4444", fontSize: 12, marginTop: 4, marginBottom: 4 }}
                      >
                        {newWoError}
                      </Text>
                    ) : null}
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 12,
                        marginTop: 4,
                        marginBottom: 8,
                      }}
                    >
                      Saved as a quote — add line items later from the Orders screen.
                    </Text>
                    <View style={[styles.actions, { justifyContent: "flex-end" }]}>
                      <Pressable
                        style={[styles.secondaryBtn, { borderColor: colors.border }]}
                        onPress={() => {
                          setWoFormOpen(false);
                          setNewWoError(null);
                        }}
                      >
                        <Text
                          style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}
                        >
                          Back
                        </Text>
                      </Pressable>
                      <Pressable
                        disabled={creatingWO}
                        style={[
                          styles.primaryBtn,
                          { backgroundColor: accent, opacity: creatingWO ? 0.6 : 1 },
                        ]}
                        onPress={handleCreateWorkOrder}
                        testID="newwo-save"
                      >
                        {creatingWO ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Feather name="check" size={14} color="#fff" />
                        )}
                        <Text style={styles.primaryBtnText}>
                          {creatingWO ? "Creating…" : "Create work order"}
                        </Text>
                      </Pressable>
                    </View>
                  </ScrollView>
                ) : (
                  <ScrollView style={{ maxHeight: 360 }}>
                    <Pressable
                      style={[
                        styles.pickerRow,
                        {
                          borderColor: accent,
                          borderWidth: 1,
                          borderBottomWidth: 1,
                          borderRadius: 10,
                          marginBottom: 8,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        },
                      ]}
                      onPress={() => {
                        setNewWoError(null);
                        setWoFormOpen(true);
                      }}
                      testID="newwo-open"
                    >
                      <Feather name="plus-circle" size={18} color={accent} />
                      <Text
                        style={{ color: accent, fontFamily: "Inter_600SemiBold", flex: 1 }}
                      >
                        New work order
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.pickerRow, { borderColor: colors.border }]}
                      onPress={() => {
                        setWorkOrderId(null);
                        setPickerOpen(false);
                      }}
                    >
                      <Text style={{ color: colors.foreground }}>None — customer only</Text>
                    </Pressable>
                    {(workOrders ?? []).map((wo) => (
                      <Pressable
                        key={wo.id}
                        style={[styles.pickerRow, { borderColor: colors.border }]}
                        onPress={() => {
                          setWorkOrderId(wo.id);
                          setPickerOpen(false);
                        }}
                      >
                        <Text
                          style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}
                        >
                          WO {wo.orderNumber}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                          {wo.status}
                          {wo.deliveryDate ? ` · delivers ${wo.deliveryDate}` : ""}
                        </Text>
                      </Pressable>
                    ))}
                    {!workOrders?.length ? (
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          textAlign: "center",
                          padding: 12,
                          fontSize: 13,
                        }}
                      >
                        No existing work orders — tap "New work order" above to create one.
                      </Text>
                    ) : null}
                  </ScrollView>
                )}
              </Pressable>
            </Pressable>
          </Modal>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: { width: "100%", maxWidth: 420, borderRadius: 18, borderWidth: 1, padding: 20 },
  pickerSheet: { width: "100%", maxWidth: 420, borderRadius: 18, borderWidth: 1, padding: 16 },
  pickerRow: { paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, gap: 2 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  center: { alignItems: "center", paddingVertical: 12 },
  clockCircle: {
    width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center", marginVertical: 16,
  },
  elapsed: {
    fontSize: 32, fontVariant: ["tabular-nums"], fontFamily: "Inter_600SemiBold", marginBottom: 6,
  },
  hint: { fontSize: 13, marginBottom: 16, textAlign: "center", paddingHorizontal: 12 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  primaryBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10 },
  primaryBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  secondaryBtn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  secondaryBtnText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  successIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  errorText: { fontSize: 14, textAlign: "center", marginVertical: 14 },
  field: { marginVertical: 6 },
  label: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  pickerBtn: { flexDirection: "row", alignItems: "center" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
});
