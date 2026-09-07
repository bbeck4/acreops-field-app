import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface Props {
  title: string;
  status: string;
  priority?: string | null;
  dueDate?: string | null;
  projectName?: string | null;
  ownerName?: string | null;
  visibility?: string;
  sharedMemberCount?: number;
  onPress?: () => void;
  isUpdating?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

function getStatusColor(status: string, colors: ReturnType<typeof useColors>) {
  switch (status) {
    case "todo": return { bg: colors.muted, fg: colors.mutedForeground };
    case "in_progress": return { bg: colors.secondary, fg: colors.secondaryForeground };
    case "done": return { bg: colors.accent, fg: colors.primary };
    default: return { bg: colors.muted, fg: colors.mutedForeground };
  }
}

function getPriorityColor(priority: string | null | undefined, colors: ReturnType<typeof useColors>) {
  switch (priority?.toLowerCase()) {
    case "high": return colors.destructive;
    case "medium": return colors.warning;
    case "low": return colors.primary;
    default: return colors.mutedForeground;
  }
}

function getPriorityIcon(priority: string | null | undefined) {
  switch (priority?.toLowerCase()) {
    case "high": return "alert-circle";
    case "medium": return "minus";
    case "low": return "arrow-down";
    default: return "minus";
  }
}

export function TaskCard({ title, status, priority, dueDate, projectName, ownerName, visibility, sharedMemberCount, onPress, isUpdating }: Props) {
  const colors = useColors();
  const priorityColor = getPriorityColor(priority, colors);
  const priorityIcon = getPriorityIcon(priority);
  const dueLabel = dueDate
    ? new Date(dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  const statusColor = getStatusColor(status, colors);
  const statusLabel = STATUS_LABELS[status] ?? status;
  const priorityLabel = priority ? `${priority.charAt(0).toUpperCase() + priority.slice(1)} priority` : "Normal priority";
  const details = [
    `${priorityLabel}`,
    `status ${statusLabel}`,
    projectName ? `project ${projectName}` : null,
    ownerName ? `owner ${ownerName}` : null,
    dueLabel ? `due ${dueLabel}` : null,
    visibility === "organization" ? "entire team" : visibility === "private" ? sharedMemberCount ? `shared with ${sharedMemberCount}` : "private" : null,
  ].filter(Boolean).join(", ");

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress || isUpdating}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: isUpdating ? 0.6 : 1,
        },
        pressed && onPress && { transform: [{ scale: 0.99 }], backgroundColor: colors.muted }
      ]}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `Task ${title}, ${details}. Opens task details.` : `Task ${title}, ${details}.`}
      accessibilityHint={onPress ? "Double tap to open task details" : undefined}
    >
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Feather name={priorityIcon as any} size={16} color={priorityColor} style={{ marginTop: 2 }} />
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
            {title}
          </Text>
        </View>
        <View style={styles.footer}>
          <View style={[styles.priorityPill, { backgroundColor: colors.muted }]}>
            <Feather name={priorityIcon as any} size={12} color={priorityColor} />
            <Text style={[styles.priorityText, { color: colors.mutedForeground }]}>{priorityLabel}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
            <Text
              style={[styles.statusText, { color: statusColor.fg }]}
              numberOfLines={1}
            >
              {statusLabel}
            </Text>
            {onPress ? <Feather name="chevron-right" size={12} color={statusColor.fg} style={styles.statusIcon} /> : null}
          </View>

          {visibility === "private" ? (
            <View style={[styles.privacyPill, { backgroundColor: colors.muted }]}>
              <Feather name="lock" size={12} color={colors.mutedForeground} />
              <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
                {sharedMemberCount && sharedMemberCount > 0
                  ? `Shared with ${sharedMemberCount}`
                  : "Private"}
              </Text>
            </View>
          ) : visibility === "organization" ? (
            <View style={[styles.privacyPill, { backgroundColor: colors.muted }]}>
              <Feather name="globe" size={12} color={colors.mutedForeground} />
              <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
                Entire team
              </Text>
            </View>
          ) : null}

          {projectName ? (
            <View style={[styles.projectPill, { backgroundColor: colors.muted }]}>
              <Text style={[styles.project, { color: colors.mutedForeground }]} numberOfLines={1}>
                {projectName}
              </Text>
            </View>
          ) : null}

          {ownerName ? (
            <View style={styles.iconRow}>
              <Feather name="user" size={12} color={colors.mutedForeground} />
              <Text style={[styles.due, { color: colors.mutedForeground }]}>{ownerName}</Text>
            </View>
          ) : null}

          {dueLabel ? (
            <View style={styles.iconRow}>
              <Feather name="calendar" size={12} color={colors.mutedForeground} />
              <Text style={[styles.due, { color: colors.mutedForeground }]}>{dueLabel}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1.5,
    overflow: "hidden",
    marginHorizontal: 16,
    marginBottom: 10,
    minHeight: 44,
  },
  body: { padding: 14, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", lineHeight: 22, letterSpacing: -0.2 },
  footer: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  projectPill: { maxWidth: "100%", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  project: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  priorityPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 4 },
  priorityText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  privacyPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  privacyText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  iconRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  due: { fontSize: 12, fontFamily: "Inter_500Medium" },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusText: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },
  statusIcon: { marginLeft: 4 },
});
