import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

type Phase = "idle" | "recording" | "uploading" | "transcribing" | "review" | "done" | "error";

interface FollowUpDraft {
  title: string;
  description: string | null;
  dueDate: string | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function inferContentType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/m4a";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".caf")) return "audio/x-caf";
  return "application/octet-stream";
}

async function readUriAsBytes(uri: string): Promise<Uint8Array> {
  // fetch() handles file://, blob:, content:// and http(s):// URIs in RN/Expo.
  const res = await fetch(uri);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

interface Props {
  /** Which entity the voice note is logged against. Defaults to "customer". */
  entityType?: "customer" | "prospect";
  /** Customer or prospect id, depending on entityType. */
  entityId: number;
  visible: boolean;
  onClose: () => void;
  /**
   * Called after the voice-note activity is created. `activityId` is the id of
   * the new activity (undefined in "transcribe" mode, where nothing is stored).
   */
  onSaved: (transcript: string, activityId?: number) => void;
  /**
   * "save" (default): stores audio + transcribes + creates a voice_note activity.
   * "transcribe": only transcribes and returns the text (no audio stored, no
   * activity created) so the caller can prefill a composer for review/edit.
   */
  mode?: "save" | "transcribe";
}

export function VoiceNoteRecorder({ entityType = "customer", entityId, visible, onClose, onSaved, mode = "save" }: Props) {
  const colors = useColors();
  const { getToken } = useAuth();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [followUps, setFollowUps] = useState<FollowUpDraft[]>([]);
  const [savingFollowUps, setSavingFollowUps] = useState(false);
  const startedAtRef = useRef<number>(0);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setTranscript("");
    setFollowUps([]);
    setSavingFollowUps(false);
    startedAtRef.current = 0;
  }, []);

  const handleClose = useCallback(() => {
    if (phase === "recording") {
      recorder.stop().catch(() => {});
    }
    reset();
    onClose();
  }, [phase, recorder, reset, onClose]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError("Microphone permission is required to record voice notes.");
        setPhase("error");
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAtRef.current = Date.now();
      setPhase("recording");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start recording");
      setPhase("error");
    }
  }, [recorder]);

  const stopAndUpload = useCallback(async () => {
    setPhase("uploading");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let durationMs = Date.now() - startedAtRef.current;
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri ?? null;
      if (state.durationMillis && state.durationMillis > 0) {
        durationMs = state.durationMillis;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not stop recording");
      setPhase("error");
      return;
    }
    if (!uri) {
      setError("Recording produced no audio file.");
      setPhase("error");
      return;
    }

    try {
      const bytes = await readUriAsBytes(uri);
      if (bytes.length === 0) {
        setError("Recording is empty. Please try again.");
        setPhase("error");
        return;
      }
      const contentType = inferContentType(uri);
      setPhase("transcribing");

      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (!domain) throw new Error("API domain not configured");
      const token = await getToken();
      if (!token) throw new Error("Not signed in");

      const base =
        entityType === "prospect"
          ? `/api/prospects/${entityId}/voice-note`
          : `/api/customers/${entityId}/voice-note`;
      const path = mode === "transcribe" ? `${base}?transcribeOnly=true` : base;
      const res = await fetch(
        `https://${domain}${path}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": contentType,
            "X-Duration-Ms": String(Math.round(durationMs)),
          },
          body: bytes as unknown as BodyInit,
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (res.status === 403 && entityType === "prospect") {
          throw new Error(
            "You don't have permission to log voice notes on prospects. Try a customer instead.",
          );
        }
        throw new Error(`Upload failed (${res.status}): ${body || res.statusText}`);
      }

      const data = (await res.json()) as {
        transcript?: string;
        followUps?: FollowUpDraft[];
        activity?: { id?: number };
      };
      const text = (data.transcript ?? "").trim();
      setTranscript(text);
      // The voice-note activity is already saved; refresh the caller's list now.
      const savedId = typeof data.activity?.id === "number" ? data.activity.id : undefined;
      onSaved(text, savedId);

      // In "save" mode the server returns AI-extracted reminders as proposals.
      // Let the rep review/edit/discard them before they persist. Falls back to
      // the plain success screen when none were extracted (or in transcribe mode).
      const proposed = Array.isArray(data.followUps) ? data.followUps : [];
      if (mode === "save" && proposed.length > 0) {
        setFollowUps(
          proposed.map((f) => ({
            title: f.title ?? "",
            description: f.description ?? null,
            dueDate: f.dueDate ?? null,
          })),
        );
        setPhase("review");
      } else {
        setPhase("done");
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setPhase("error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [entityType, entityId, getToken, onSaved, recorder, state.durationMillis, mode]);

  const updateFollowUp = useCallback(
    (index: number, patch: Partial<FollowUpDraft>) => {
      setFollowUps((prev) =>
        prev.map((f, i) => (i === index ? { ...f, ...patch } : f)),
      );
    },
    [],
  );

  const removeFollowUp = useCallback((index: number) => {
    setFollowUps((prev) => prev.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const saveFollowUps = useCallback(async () => {
    const kept = followUps
      .map((f) => ({
        title: f.title.trim(),
        description: f.description?.trim() ? f.description.trim() : null,
        dueDate: f.dueDate && ISO_DATE_RE.test(f.dueDate.trim()) ? f.dueDate.trim() : null,
      }))
      .filter((f) => f.title.length > 0);

    if (kept.length === 0) {
      setPhase("done");
      return;
    }

    setSavingFollowUps(true);
    try {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (!domain) throw new Error("API domain not configured");
      const token = await getToken();
      if (!token) throw new Error("Not signed in");

      const res = await fetch(`https://${domain}/api/voice-notes/follow-ups`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          [entityType === "prospect" ? "prospectId" : "customerId"]: entityId,
          followUps: kept,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Save failed (${res.status}): ${body || res.statusText}`);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save reminders");
      setPhase("error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSavingFollowUps(false);
    }
  }, [followUps, entityType, entityId, getToken]);

  const cancelRecording = useCallback(async () => {
    try {
      await recorder.stop();
    } catch {
      /* ignore */
    }
    reset();
  }, [recorder, reset]);

  const elapsed = phase === "recording" ? state.durationMillis ?? Date.now() - startedAtRef.current : 0;
  const meterScale = Math.min(1.5, 1 + Math.max(0, ((state.metering ?? -60) + 60) / 60) * 0.5);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>Voice Note</Text>
            <Pressable onPress={handleClose} hitSlop={8} testID="voice-close">
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {phase === "idle" || phase === "recording" ? (
            <View style={styles.center}>
              <View
                style={[
                  styles.micCircle,
                  {
                    backgroundColor: phase === "recording" ? "#ef4444" : colors.primary,
                    transform: [{ scale: phase === "recording" ? meterScale : 1 }],
                  },
                ]}
              >
                <Feather name="mic" size={36} color="#fff" />
              </View>
              <Text style={[styles.elapsed, { color: colors.foreground }]}>
                {formatElapsed(elapsed)}
              </Text>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                {phase === "recording"
                  ? "Recording — tap stop when finished"
                  : "Tap the mic to start recording"}
              </Text>

              <View style={styles.actions}>
                {phase === "idle" ? (
                  <Pressable
                    style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                    onPress={startRecording}
                    testID="voice-start"
                  >
                    <Feather name="mic" size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>Start recording</Text>
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      style={[styles.secondaryBtn, { borderColor: colors.border }]}
                      onPress={cancelRecording}
                      testID="voice-cancel"
                    >
                      <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>
                        Cancel
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.primaryBtn, { backgroundColor: "#ef4444" }]}
                      onPress={stopAndUpload}
                      testID="voice-stop"
                    >
                      <Feather name="square" size={14} color="#fff" />
                      <Text style={styles.primaryBtnText}>Stop & save</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          ) : null}

          {phase === "uploading" || phase === "transcribing" ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.elapsed, { color: colors.foreground, marginTop: 16 }]}>
                {phase === "uploading" ? "Uploading…" : "Transcribing…"}
              </Text>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                Hang tight, this usually takes a few seconds.
              </Text>
            </View>
          ) : null}

          {phase === "review" ? (
            <View style={styles.reviewWrap}>
              <Text style={[styles.reviewTitle, { color: colors.foreground }]}>
                Review reminders
              </Text>
              <Text style={[styles.hint, { color: colors.mutedForeground, marginBottom: 8 }]}>
                We found {followUps.length} action item{followUps.length === 1 ? "" : "s"} in your note. Edit, keep, or remove each before saving.
              </Text>
              <ScrollView style={styles.reviewList} keyboardShouldPersistTaps="handled">
                {followUps.map((f, i) => (
                  <View
                    key={i}
                    style={[
                      styles.reviewItem,
                      { backgroundColor: colors.background, borderColor: colors.border },
                    ]}
                  >
                    <View style={styles.reviewItemHeader}>
                      <Text style={[styles.reviewItemLabel, { color: colors.mutedForeground }]}>
                        Reminder {i + 1}
                      </Text>
                      <Pressable
                        onPress={() => removeFollowUp(i)}
                        hitSlop={8}
                        testID={`followup-remove-${i}`}
                      >
                        <Feather name="trash-2" size={16} color="#ef4444" />
                      </Pressable>
                    </View>
                    <TextInput
                      value={f.title}
                      onChangeText={(t) => updateFollowUp(i, { title: t })}
                      placeholder="Reminder title"
                      placeholderTextColor={colors.mutedForeground}
                      style={[
                        styles.reviewInput,
                        { color: colors.foreground, borderColor: colors.border },
                      ]}
                      testID={`followup-title-${i}`}
                      multiline
                    />
                    <TextInput
                      value={f.dueDate ?? ""}
                      onChangeText={(t) => updateFollowUp(i, { dueDate: t.trim() ? t.trim() : null })}
                      placeholder="Due date (YYYY-MM-DD) — optional"
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="none"
                      style={[
                        styles.reviewInput,
                        { color: colors.foreground, borderColor: colors.border, marginTop: 8 },
                      ]}
                      testID={`followup-due-${i}`}
                    />
                    {f.dueDate && !ISO_DATE_RE.test(f.dueDate) ? (
                      <Text style={styles.reviewWarn}>Use YYYY-MM-DD or clear to leave no due date.</Text>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
              <View style={styles.actions}>
                <Pressable
                  style={[styles.secondaryBtn, { borderColor: colors.border }]}
                  onPress={() => setPhase("done")}
                  disabled={savingFollowUps}
                  testID="followup-skip"
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>
                    Skip
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                  onPress={saveFollowUps}
                  disabled={savingFollowUps}
                  testID="followup-save"
                >
                  {savingFollowUps ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Feather name="check" size={16} color="#fff" />
                  )}
                  <Text style={styles.primaryBtnText}>
                    {followUps.length === 1 ? "Save reminder" : "Save reminders"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {phase === "done" ? (
            <View style={styles.center}>
              <View style={[styles.successIcon, { backgroundColor: colors.accent }]}>
                <Feather name="check" size={28} color={colors.primary} />
              </View>
              <Text style={[styles.elapsed, { color: colors.foreground, fontSize: 16 }]}>
                {mode === "transcribe" ? "Transcribed" : "Saved as activity"}
              </Text>
              {transcript ? (
                <View
                  style={[
                    styles.transcriptBox,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.transcriptLabel, { color: colors.mutedForeground }]}>
                    Transcript
                  </Text>
                  <Text style={[styles.transcriptText, { color: colors.foreground }]}>
                    {transcript}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  No speech detected — saved as a brief note.
                </Text>
              )}
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 8 }]}
                onPress={handleClose}
                testID="voice-done"
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
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    reset();
                  }}
                >
                  <Text style={styles.primaryBtnText}>Try again</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
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
  sheet: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  center: { alignItems: "center", paddingVertical: 12 },
  micCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 16,
  },
  elapsed: {
    fontSize: 28,
    fontVariant: ["tabular-nums"],
    fontFamily: "Inter_600SemiBold",
    marginBottom: 6,
  },
  hint: { fontSize: 13, marginBottom: 16, textAlign: "center", paddingHorizontal: 12 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  secondaryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  secondaryBtnText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  transcriptBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginVertical: 12,
    width: "100%",
    maxHeight: 220,
  },
  transcriptLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
    fontFamily: "Inter_500Medium",
  },
  transcriptText: { fontSize: 14, lineHeight: 20 },
  errorText: { fontSize: 14, textAlign: "center", marginVertical: 14 },
  reviewWrap: { paddingVertical: 4 },
  reviewTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  reviewList: { maxHeight: 320, marginBottom: 12 },
  reviewItem: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  reviewItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  reviewItemLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontFamily: "Inter_500Medium",
  },
  reviewInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  reviewWarn: { color: "#ef4444", fontSize: 11, marginTop: 4 },
});
