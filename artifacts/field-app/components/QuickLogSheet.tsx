import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListCustomerActivitiesQueryKey,
  getListProspectActivitiesQueryKey,
  useCreateActivity,
  useCreateProspectActivity,
} from "@workspace/api-client-react";

import { EntityPicker, type PickedEntity } from "@/components/EntityPicker";
import { VoiceNoteRecorder } from "@/components/VoiceNoteRecorder";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useAppAuth } from "@/context/AuthContext";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

const ACTIVITY_TYPES = ["note", "call", "visit", "email"] as const;
type SubmissionState = "idle" | "queued" | "syncing" | "failed" | "synced";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Optionally pre-select an entity so the picker is skipped. */
  preset?: PickedEntity | null;
  /**
   * Optionally link the logged activity to a work order so it appears on that
   * order's timeline. Only applies to customer activities.
   */
  workOrderId?: number | null;
  /** Hide the entity selector (used when the entity is fixed, e.g. on an order). */
  lockEntity?: boolean;
}

export function QuickLogSheet({
  visible,
  onClose,
  preset = null,
  workOrderId = null,
  lockEntity = false,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { currentMember } = useAppAuth();
  const {
    isOnline,
    queueWrite,
    pendingWrites,
    syncingWriteIds,
    retryItem,
    triggerFlush,
    openTray,
  } = useOffline();

  const [entity, setEntity] = useState<PickedEntity | null>(preset);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [actType, setActType] = useState<(typeof ACTIVITY_TYPES)[number]>("note");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [feedback, setFeedback] = useState<"idle" | "failed" | "synced">("idle");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [queuedWriteId, setQueuedWriteId] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const { mutateAsync: createCustomerActivity } = useCreateActivity();
  const { mutateAsync: createProspectActivity } = useCreateProspectActivity();

  React.useEffect(() => {
    if (visible) {
      setEntity(preset);
      if (!preset) setPickerOpen(true);
    }
  }, [visible, preset]);

  const reset = () => {
    setEntity(preset);
    setActType("note");
    setSubject("");
    setNotes("");
    setShowVoice(false);
    setPickerOpen(false);
    setFeedback("idle");
    setFeedbackMessage("");
    setQueuedWriteId(null);
    setIsRetrying(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const invalidateTimeline = (e: PickedEntity) => {
    if (e.entityType === "customer") {
      queryClient.invalidateQueries({ queryKey: getListCustomerActivitiesQueryKey(e.id) });
    } else {
      queryClient.invalidateQueries({ queryKey: getListProspectActivitiesQueryKey(e.id) });
    }
  };

  const queuedWrite = queuedWriteId
    ? pendingWrites.find((write) => write.id === queuedWriteId)
    : undefined;
  const isQueuedWriteSyncing = queuedWriteId
    ? syncingWriteIds.includes(queuedWriteId)
    : false;
  const submissionState: SubmissionState = queuedWriteId
    ? queuedWrite?.failedReason
      ? "failed"
      : queuedWrite
        ? isQueuedWriteSyncing
          ? "syncing"
          : "queued"
        : "synced"
    : feedback;
  const isRecorded = queuedWriteId !== null || submissionState === "synced";
  const isConflict = !!queuedWrite?.failedReason?.match(/conflict|changed|409/i);

  React.useEffect(() => {
    if (isRetrying && (!queuedWrite || queuedWrite.failedReason)) {
      setIsRetrying(false);
    }
  }, [isRetrying, queuedWrite]);

  const submit = async () => {
    if (!entity || !subject.trim()) return;
    setIsSaving(true);
    setFeedback("idle");
    setFeedbackMessage("");
    if (entity.entityType === "customer") {
      // Mirror the customer screen's inline logger: when offline (or if the
      // online write fails) fall back to the offline write queue so reps in
      // the field never lose an order-linked activity. The queued payload
      // carries workOrderId, which QueueSync forwards on replay so the
      // synced activity lands on the order timeline.
      const payload = {
        customerId: entity.id,
        memberId: currentMember?.id,
        type: actType,
        subject: subject.trim(),
        notes: notes.trim() || undefined,
        workOrderId: workOrderId ?? undefined,
      };
      try {
        if (isOnline) {
          try {
            await createCustomerActivity({ data: payload });
            invalidateTimeline(entity);
            setFeedback("synced");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            return;
          } catch {
            const writeId = await queueWrite("activity", payload);
            setQueuedWriteId(writeId);
            triggerFlush();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            return;
          }
        } else {
          const writeId = await queueWrite("activity", payload);
          setQueuedWriteId(writeId);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return;
        }
      } catch {
        setFeedback("failed");
        setFeedbackMessage("This entry could not be saved or queued. Your draft is still here; try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    if (!isOnline) {
      setFeedback("failed");
      setFeedbackMessage("Prospect logs need a connection to save. Your draft is still here; reconnect and try again.");
      setIsSaving(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    try {
      await createProspectActivity({
        id: entity.id,
        data: {
          type: actType,
          subject: subject.trim(),
          notes: notes.trim() || undefined,
        },
      });
      invalidateTimeline(entity);
      setFeedback("synced");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setFeedback("failed");
      setFeedbackMessage("This prospect log was not saved. Your draft is still here; try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  const retryQueuedWrite = async () => {
    if (!queuedWriteId || !isOnline) return;
    setIsRetrying(true);
    try {
      await retryItem(queuedWriteId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setIsRetrying(false);
      setFeedbackMessage("Retry could not start. Open the sync queue to review this entry.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const statusTitle =
    submissionState === "queued"
      ? isRetrying
        ? "Retry queued"
        : isOnline
          ? "Saved for sync"
          : "Saved offline"
      : submissionState === "syncing"
        ? isRetrying
          ? "Retrying activity"
          : "Syncing activity"
        : submissionState === "synced"
          ? "Activity synced"
          : submissionState === "failed"
            ? isConflict
              ? "Sync conflict"
              : queuedWriteId
                ? "Sync needs attention"
                : "Activity not saved"
            : "";
  const statusMessage =
    submissionState === "queued"
      ? isRetrying
        ? "The saved entry is waiting for its retry to start."
        : isOnline
          ? "This entry is safely queued and waiting to sync."
          : "This entry is safely queued and will sync when a connection returns."
      : submissionState === "syncing"
        ? "The saved entry is being sent. You can close this sheet."
        : submissionState === "synced"
          ? "This entry is complete and available on the activity timeline."
          : submissionState === "failed"
            ? queuedWrite?.failedReason || feedbackMessage
            : "";
  const statusForeground =
    submissionState === "failed"
      ? colors.destructive
      : submissionState === "queued"
        ? colors.warning
        : colors.primary;
  const statusBackground =
    submissionState === "failed"
      ? colors.destructive + "12"
      : submissionState === "queued"
        ? colors.warning + "12"
        : colors.accent;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>Quick Log</Text>
            <Pressable
              onPress={handleClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close Quick Log"
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <KeyboardAwareScrollViewCompat
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            bottomOffset={insets.bottom + 72}
          >
            <Pressable
              style={[styles.entitySelector, { borderColor: colors.border, backgroundColor: colors.background }]}
              onPress={() => setPickerOpen(true)}
              disabled={lockEntity || isRecorded}
              accessibilityRole="button"
              accessibilityLabel={
                entity
                  ? `Activity for ${entity.entityType} ${entity.name}`
                  : "Select a customer or prospect"
              }
              accessibilityHint={lockEntity || isRecorded ? undefined : "Opens the customer and prospect picker"}
              accessibilityState={{ disabled: lockEntity || isRecorded }}
            >
              {entity ? (
                <View style={{ flex: 1 }}>
                  <Text style={[styles.entityName, { color: colors.foreground }]} numberOfLines={1}>
                    {entity.name}
                  </Text>
                  <Text
                    style={[
                      styles.entityTag,
                      { color: entity.entityType === "prospect" ? colors.warning : colors.primary },
                    ]}
                  >
                    {entity.entityType === "prospect" ? "Prospect" : "Customer"}
                    {entity.subtitle ? ` · ${entity.subtitle}` : ""}
                  </Text>
                </View>
              ) : (
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", flex: 1 }}>
                  Select customer or prospect…
                </Text>
              )}
              {lockEntity || isRecorded ? null : (
                <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
              )}
            </Pressable>

            <View style={styles.typeRow} accessibilityRole="radiogroup">
              {ACTIVITY_TYPES.map((t) => (
                <Pressable
                  key={t}
                  style={[
                    styles.typeBtn,
                    {
                      borderColor: actType === t ? colors.primary : colors.border,
                      backgroundColor: actType === t ? colors.accent : "transparent",
                      opacity: isRecorded ? 0.65 : 1,
                    },
                  ]}
                  onPress={() => setActType(t)}
                  disabled={isRecorded}
                  accessibilityRole="radio"
                  accessibilityLabel={`${t.charAt(0).toUpperCase() + t.slice(1)} activity`}
                  accessibilityState={{ selected: actType === t, disabled: isRecorded }}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      { color: actType === t ? colors.primary : colors.mutedForeground },
                    ]}
                  >
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
              ]}
              placeholder="Subject *"
              placeholderTextColor={colors.mutedForeground}
              value={subject}
              onChangeText={setSubject}
              editable={!isRecorded}
              accessibilityLabel="Activity subject, required"
            />
            <TextInput
              style={[
                styles.input,
                styles.textarea,
                { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
              ]}
              placeholder="Notes (optional)"
              placeholderTextColor={colors.mutedForeground}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              editable={!isRecorded}
              accessibilityLabel="Activity notes, optional"
            />

            {submissionState !== "idle" ? (
              <View
                style={[styles.statusCard, { backgroundColor: statusBackground, borderColor: statusForeground + "40" }]}
              >
                <View
                  style={styles.statusCopy}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  accessible
                  accessibilityLabel={`${statusTitle}. ${statusMessage}`}
                >
                  {submissionState === "syncing" ? (
                    <ActivityIndicator size="small" color={statusForeground} />
                  ) : (
                    <Feather
                      name={
                        submissionState === "failed"
                          ? "alert-circle"
                          : submissionState === "queued"
                            ? "clock"
                            : "check-circle"
                      }
                      size={18}
                      color={statusForeground}
                    />
                  )}
                  <View style={styles.statusTextWrap}>
                    <Text style={[styles.statusTitle, { color: statusForeground }]}>{statusTitle}</Text>
                    <Text style={[styles.statusMessage, { color: colors.foreground }]}>{statusMessage}</Text>
                  </View>
                </View>
                {queuedWriteId ? (
                  <View style={styles.statusActions}>
                    {submissionState === "failed" ? (
                      <Pressable
                        style={[styles.statusAction, { borderColor: statusForeground }]}
                        onPress={retryQueuedWrite}
                        disabled={!isOnline || isRetrying}
                        accessibilityRole="button"
                        accessibilityLabel="Retry syncing this activity"
                        accessibilityState={{ disabled: !isOnline || isRetrying }}
                      >
                        <Feather name="refresh-cw" size={14} color={statusForeground} />
                        <Text style={[styles.statusActionText, { color: statusForeground }]}>
                          {isRetrying ? "Retrying…" : "Retry now"}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      style={[styles.statusAction, { borderColor: colors.border }]}
                      onPress={openTray}
                      accessibilityRole="button"
                      accessibilityLabel="Open sync queue"
                    >
                      <Text style={[styles.statusActionText, { color: colors.foreground }]}>View sync</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                style={[
                  styles.voiceBtn,
                  { borderColor: colors.border, opacity: entity && !isRecorded ? 1 : 0.5 },
                ]}
                disabled={!entity || isRecorded}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setShowVoice(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Record Voice Note"
                accessibilityState={{ disabled: !entity || isRecorded }}
              >
                <Feather name="mic" size={16} color={colors.destructive} />
                <Text style={[styles.voiceBtnText, { color: colors.foreground }]}>Voice</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: isRecorded || (entity && subject.trim() && !isSaving) ? 1 : 0.5,
                  },
                ]}
                disabled={!isRecorded && (!entity || !subject.trim() || isSaving)}
                onPress={isRecorded ? handleClose : submit}
                accessibilityRole="button"
                accessibilityLabel={
                  isRecorded ? "Done with Quick Log" : feedback === "failed" ? "Retry saving activity" : "Save activity"
                }
                accessibilityState={{ disabled: !isRecorded && (!entity || !subject.trim() || isSaving) }}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {isRecorded ? "Done" : feedback === "failed" ? "Try again" : "Save activity"}
                  </Text>
                )}
              </Pressable>
            </View>
          </KeyboardAwareScrollViewCompat>
        </View>
      </View>

      <EntityPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(e) => {
          setEntity(e);
          setPickerOpen(false);
        }}
      />

      {entity && entity.entityType !== "project" ? (
        <VoiceNoteRecorder
          entityType={entity.entityType}
          entityId={entity.id}
          mode="transcribe"
          visible={showVoice}
          onClose={() => setShowVoice(false)}
          onSaved={(text) => {
            const t = text.trim();
            if (t) {
              setNotes((prev) => (prev.trim() ? `${prev.trim()}\n${t}` : t));
              setSubject((prev) => (prev.trim() ? prev : t.length <= 80 ? t : `${t.slice(0, 77)}…`));
            }
          }}
        />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10 },
  scroll: { maxHeight: 560 },
  scrollContent: { paddingBottom: 76 },
  entitySelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  entityName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  entityTag: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  typeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 },
  typeBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1, minHeight: 44, alignItems: "center", justifyContent: "center" },
  typeBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginBottom: 10,
  },
  textarea: { minHeight: 80, textAlignVertical: "top" },
  statusCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 10,
    marginBottom: 10,
  },
  statusCopy: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  statusTextWrap: { flex: 1, gap: 3 },
  statusTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  statusMessage: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  statusActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" },
  statusAction: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  statusActionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  voiceBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
  },
  voiceBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  saveBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: 10,
  },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
