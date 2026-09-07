import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  title: string;
  status: string;
  dueDate?: string | null;
  ownerName?: string | null;
  visibility?: string;
  sharedMemberCount?: number;
  taskCount?: number;
  completedTaskCount?: number;
  onPress?: () => void;
  isUpdating?: boolean;
}

function getStatusColor(status: string, colors: ReturnType<typeof useColors>) {
  switch (normalizedStatus(status)) {
    case "open":
      return { bg: colors.secondary, fg: colors.secondaryForeground };
    case "on_hold":
      return { bg: colors.muted, fg: colors.mutedForeground };
    case "completed":
      return { bg: colors.accent, fg: colors.primary };
    case "cancelled":
      return { bg: colors.destructive + "22", fg: colors.destructive };
    default:
      return { bg: colors.muted, fg: colors.mutedForeground };
  }
}

function normalizedStatus(status: string) {
  const normalized = status.trim().toLowerCase().replaceAll("_", " ");
  if (normalized === "completed" || normalized === "done") return "completed";
  if (normalized === "cancelled") return "cancelled";
  if (normalized === "on hold") return "on_hold";
  return "open";
}

function projectStatusLabel(status: string) {
  switch (normalizedStatus(status)) {
    case "on_hold":
      return "On Hold";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Open";
  }
}

export function ProjectCard({
  title,
  status,
  dueDate,
  ownerName,
  visibility,
  sharedMemberCount,
  taskCount,
  completedTaskCount,
  onPress,
  isUpdating,
}: Props) {
  const colors = useColors();
  const dueLabel = dueDate
    ? new Date(dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  const statusColor = getStatusColor(status, colors);
  const statusLabel = projectStatusLabel(status);
  const details = [
    `status ${statusLabel}`,
    visibility === "organization"
      ? "entire team"
      : sharedMemberCount
        ? `shared with ${sharedMemberCount}`
        : "private",
    ownerName ? `owner ${ownerName}` : null,
    dueLabel ? `due ${dueLabel}` : null,
    taskCount !== undefined ? `${completedTaskCount ?? 0} of ${taskCount} tasks complete` : null,
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
        pressed && onPress && { transform: [{ scale: 0.99 }], backgroundColor: colors.muted },
      ]}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`Project ${title}, ${details}.`}
      accessibilityHint={onPress ? "Double tap to open project details" : undefined}
    >
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.footer}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
            <Text
              style={[styles.statusText, { color: statusColor.fg }]}
              numberOfLines={1}
            >
              {statusLabel}
            </Text>
            {onPress ? (
              <Feather name="chevron-right" size={14} color={statusColor.fg} style={styles.statusIcon} />
            ) : null}
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
          ) : (
            <View style={[styles.privacyPill, { backgroundColor: colors.muted }]}>
              <Feather name="globe" size={12} color={colors.mutedForeground} />
              <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
                Entire team
              </Text>
            </View>
          )}

          {ownerName ? (
            <View style={styles.iconRow}>
              <Feather name="user" size={12} color={colors.mutedForeground} />
              <Text style={[styles.textLabel, { color: colors.mutedForeground }]}>
                {ownerName}
              </Text>
            </View>
          ) : null}

          {dueLabel ? (
            <View style={styles.iconRow}>
              <Feather name="calendar" size={12} color={colors.mutedForeground} />
              <Text style={[styles.textLabel, { color: colors.mutedForeground }]}>
                {dueLabel}
              </Text>
            </View>
          ) : null}
          {taskCount !== undefined ? (
            <View style={styles.iconRow}>
              <Feather name="check-circle" size={12} color={colors.mutedForeground} />
              <Text style={[styles.textLabel, { color: colors.mutedForeground }]}>
                {completedTaskCount ?? 0}/{taskCount}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1.5,
    overflow: "hidden",
    marginHorizontal: 16,
    marginBottom: 10,
    minHeight: 44,
  },
  body: { flex: 1, padding: 14, gap: 8 },
  title: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  footer: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  privacyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  privacyText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  iconRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  textLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
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
