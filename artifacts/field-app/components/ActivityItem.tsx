import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import type { ComponentProps } from "react";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { activityNotesLineLimit, isAudioBackedActivity } from "@/lib/activityAudio";

type FeatherName = ComponentProps<typeof Feather>["name"];

interface Props {
  type: string;
  subtype?: string | null;
  subject: string;
  notes?: string | null;
  memberName?: string | null;
  createdAt: string;
  isLast?: boolean;
  workOrderNumber?: string | null;
  durationMinutes?: number | null;
  billable?: boolean;
  activityId?: number;
  audioPath?: string | null;
  audioContext?: "customer" | "prospect";
  onArchive?: () => void;
  onDelete?: () => void;
  onForward?: () => void;
  onEdit?: () => void;
  busy?: boolean;
}

const SUBTYPE_LABELS: Record<string, string> = {
  agronomic_visit: "Agronomic visit",
  service_call: "Precision service call",
  delivery: "Delivery",
  training: "Training",
  billable_consult: "Billable consult",
  other: "Other",
  margin_floor_override: "Margin override",
  margin_warning_acknowledged: "Thin-margin acknowledged",
  lifecycle: "Lifecycle",
};

function formatDuration(min: number) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function getTypeIcon(type: string, colors: ReturnType<typeof useColors>) {
  switch (type.toLowerCase()) {
    case "call": return { name: "phone" as FeatherName, bg: colors.secondary, fg: colors.secondaryForeground };
    case "visit": return { name: "map-pin" as FeatherName, bg: colors.accent, fg: colors.accentForeground };
    case "email": return { name: "mail" as FeatherName, bg: colors.muted, fg: colors.mutedForeground };
    case "note": return { name: "file-text" as FeatherName, bg: colors.muted, fg: colors.mutedForeground };
    case "voice_note": return { name: "mic" as FeatherName, bg: colors.warningBackground, fg: colors.warning };
    case "time": return { name: "clock" as FeatherName, bg: colors.warningBackground, fg: colors.warning };
    case "order": return { name: "dollar-sign" as FeatherName, bg: colors.primary, fg: colors.primaryForeground };
    default: return { name: "file-text" as FeatherName, bg: colors.muted, fg: colors.mutedForeground };
  }
}

function VoiceNotePlayer({
  activityId,
  audioContext,
}: {
  activityId: number;
  audioContext: "customer" | "prospect";
}) {
  const colors = useColors();
  const { getToken } = useAuth();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [shouldStart, setShouldStart] = useState(false);
  const player = useAudioPlayer(audioUrl ? { uri: audioUrl } : null);
  const status = useAudioPlayerStatus(player);
  const isPlaying = !!status?.playing;

  useEffect(() => {
    if (!audioUrl || !shouldStart || !status?.isLoaded) return;
    try {
      player.play();
    } catch {
      setAudioUrl(null);
      Alert.alert("Playback unavailable", "The voice memo could not be played. Tap Play to retry.");
    } finally {
      setShouldStart(false);
      setIsPreparing(false);
    }
  }, [audioUrl, player, shouldStart, status?.isLoaded]);

  useEffect(() => {
    if (!shouldStart) return;
    const timeout = setTimeout(() => {
      setShouldStart(false);
      setIsPreparing(false);
      setAudioUrl(null);
      Alert.alert("Playback unavailable", "The voice memo did not load. Check your connection and tap Play to retry.");
    }, 15_000);
    return () => clearTimeout(timeout);
  }, [shouldStart]);

  useEffect(() => {
    if (!status?.didJustFinish) return;
    try {
      player.seekTo(0);
    } catch {
      // A released player needs no reset.
    }
  }, [player, status?.didJustFinish]);

  useEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // The player may already be released while leaving the screen.
      }
    };
  }, [player]);

  const handlePlayback = async () => {
    if (isPlaying) {
      try {
        player.pause();
      } catch {
        Alert.alert("Playback unavailable", "The voice memo could not be paused.");
      }
      return;
    }

    if (audioUrl) {
      if (!status?.isLoaded) {
        setIsPreparing(true);
        setShouldStart(true);
        return;
      }
      try {
        player.play();
      } catch {
        setAudioUrl(null);
        Alert.alert("Playback unavailable", "The voice memo could not be played. Tap Play to retry.");
      }
      return;
    }

    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) {
      Alert.alert("Playback unavailable", "The app is missing its audio service address.");
      return;
    }

    setIsPreparing(true);
    try {
      const token = await getToken();
      if (!token) {
        setIsPreparing(false);
        Alert.alert("Sign-in required", "Please sign in again to play this voice memo.");
        return;
      }
      const contextQuery = audioContext === "prospect" ? "&context=prospect" : "";
      setShouldStart(true);
      setAudioUrl(
        `https://${domain}/api/voice-notes/${activityId}/audio?token=${encodeURIComponent(token)}${contextQuery}`,
      );
    } catch {
      setShouldStart(false);
      setAudioUrl(null);
      setIsPreparing(false);
      Alert.alert("Playback unavailable", "The voice memo could not be loaded. Tap Play to retry.");
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? "Pause voice memo" : "Play voice memo"}
      onPress={handlePlayback}
      disabled={isPreparing}
      style={({ pressed }) => [
        styles.audioButton,
        {
          backgroundColor: colors.muted,
          borderColor: colors.border,
          opacity: isPreparing ? 0.6 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {isPreparing ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Feather name={isPlaying ? "pause" : "play"} size={15} color={colors.primary} />
      )}
      <Text style={[styles.audioButtonLabel, { color: colors.primary }]}>
        {isPreparing ? "Loading…" : isPlaying ? "Pause voice memo" : "Play voice memo"}
      </Text>
    </Pressable>
  );
}

export function ActivityItem({
  type,
  subtype,
  subject,
  notes,
  memberName,
  createdAt,
  isLast,
  workOrderNumber,
  durationMinutes,
  billable,
  activityId,
  audioPath,
  audioContext = "customer",
  onArchive,
  onDelete,
  onForward,
  onEdit,
  busy,
}: Props) {
  const colors = useColors();
  const [notesExpanded, setNotesExpanded] = useState(false);
  const icon = getTypeIcon(type, colors);
  const subtypeLabel = subtype ? SUBTYPE_LABELS[subtype] ?? subtype : null;
  const date = new Date(createdAt);
  const dateLabel = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeLabel = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const showActions = !!(onArchive || onDelete || onForward || onEdit);
  const hasAudio = isAudioBackedActivity({ audioPath });
  const isVoiceNote = hasAudio || type.toLowerCase() === "voice_note";
  const canExpandNotes = !!notes && (
    !hasAudio && (notes.includes("\n") || notes.length > 160)
  );
  const canPlayVoiceNote = hasAudio && activityId != null;

  return (
    <View style={styles.container}>
      <View style={styles.timeline}>
        <View style={[styles.iconCircle, { backgroundColor: icon.bg, shadowColor: icon.fg, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 3 }]}>
          <Feather name={icon.name} size={16} color={icon.fg} />
        </View>
        {!isLast ? <View style={[styles.line, { backgroundColor: colors.border }]} /> : null}
      </View>
      <View style={[styles.content, { marginBottom: isLast ? 0 : 24 }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.subject, { color: colors.foreground }]} numberOfLines={2}>{subject}</Text>
            <Text style={[styles.date, { color: colors.mutedForeground }]}>{dateLabel}</Text>
          </View>

          {subtypeLabel ? (
            <View style={{ flexDirection: "row", marginTop: 4 }}>
              <View style={[styles.subtypeBadge, { backgroundColor: colors.accent }]}>
                <Text style={[styles.subtypeText, { color: colors.primary }]}>{subtypeLabel}</Text>
              </View>
            </View>
          ) : null}

          {(workOrderNumber || (durationMinutes != null && durationMinutes > 0) || billable) ? (
            <View style={styles.metaTags}>
              {workOrderNumber ? (
                <View style={[styles.woBadge, { backgroundColor: colors.secondary }]}>
                  <Feather name="clipboard" size={12} color={colors.secondaryForeground} />
                  <Text style={[styles.woText, { color: colors.secondaryForeground }]}>WO {workOrderNumber}</Text>
                </View>
              ) : null}
              {durationMinutes != null && durationMinutes > 0 ? (
                <View style={[styles.durationBadge, { backgroundColor: colors.muted }]}>
                  <Feather name="clock" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.durationText, { color: colors.mutedForeground }]}>
                    {formatDuration(durationMinutes)}
                  </Text>
                </View>
              ) : null}
              {billable ? (
                <View style={[styles.billableBadge, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.billableText, { color: colors.primaryForeground }]}>BILLABLE</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {notes ? (
            <View>
              <Text
                style={[styles.notes, { color: colors.mutedForeground }]}
                numberOfLines={activityNotesLineLimit({ audioPath }, notesExpanded)}
              >
                {notes}
              </Text>
              {canExpandNotes ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={notesExpanded ? "Collapse transcript" : "Read full transcript"}
                  onPress={() => setNotesExpanded((expanded) => !expanded)}
                  hitSlop={8}
                  style={styles.notesToggle}
                >
                  <Text style={[styles.notesToggleText, { color: colors.primary }]}>
                    {notesExpanded
                      ? isVoiceNote ? "Collapse transcript" : "Show less"
                      : isVoiceNote ? "Read full transcript" : "Show more"}
                  </Text>
                  <Feather
                    name={notesExpanded ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={colors.primary}
                  />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {canPlayVoiceNote ? (
            <VoiceNotePlayer activityId={activityId} audioContext={audioContext} />
          ) : null}

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <View style={styles.memberRow}>
              <Feather name="user" size={12} color={colors.mutedForeground} />
              <Text style={[styles.member, { color: colors.mutedForeground }]}>
                {memberName ? `${memberName} · ${timeLabel}` : timeLabel}
              </Text>
            </View>
            {showActions ? (
              <View style={styles.actions}>
                {onForward ? (
                  <Pressable onPress={onForward} disabled={busy} style={[styles.iconBtn, { opacity: busy ? 0.5 : 1 }]}>
                    <Feather name="send" size={16} color={colors.primary} />
                  </Pressable>
                ) : null}
                {onEdit ? (
                  <Pressable onPress={onEdit} disabled={busy} style={[styles.iconBtn, { opacity: busy ? 0.5 : 1 }]}>
                    <Feather name="edit-2" size={16} color={colors.primary} />
                  </Pressable>
                ) : null}
                {onArchive ? (
                  <Pressable onPress={onArchive} disabled={busy} style={[styles.iconBtn, { opacity: busy ? 0.5 : 1 }]}>
                    <Feather name="archive" size={16} color={colors.primary} />
                  </Pressable>
                ) : null}
                {onDelete ? (
                  <Pressable onPress={onDelete} disabled={busy} style={[styles.iconBtn, { opacity: busy ? 0.5 : 1 }]}>
                    <Feather name="trash-2" size={16} color={colors.destructive} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", paddingHorizontal: 16 },
  timeline: { width: 40, alignItems: "center", marginTop: 4 },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  line: { width: 2, flex: 1, marginTop: 8, minHeight: 24, borderRadius: 1 },
  content: { flex: 1, paddingBottom: 4 },
  card: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
    gap: 8,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  subject: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", lineHeight: 22 },
  date: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  subtypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  subtypeText: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  metaTags: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  woBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  woText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  durationBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  durationText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  billableBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  billableText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  notes: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginTop: 4 },
  notesToggle: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 2, paddingTop: 6, paddingBottom: 2 },
  notesToggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  audioButton: {
    minHeight: 40,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  audioButtonLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 12, borderTopWidth: 1 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  member: { fontSize: 13, fontFamily: "Inter_500Medium" },
  actions: { flexDirection: "row", gap: 12 },
  iconBtn: { padding: 4 },
});