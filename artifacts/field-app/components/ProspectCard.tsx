import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

function getStatusColor(status: string, colors: ReturnType<typeof useColors>) {
  switch (status.toLowerCase()) {
    case "new": return { bg: colors.secondary, fg: colors.secondaryForeground };
    case "contacted": return { bg: colors.warningBackground, fg: colors.warning };
    case "qualified": return { bg: colors.accent, fg: colors.accentForeground };
    case "nurturing": return { bg: colors.muted, fg: colors.mutedForeground };
    case "lost": return { bg: colors.destructive, fg: colors.destructiveForeground };
    case "converted": return { bg: colors.primary, fg: colors.primaryForeground };
    default: return { bg: colors.muted, fg: colors.mutedForeground };
  }
}

function getIntakeBadge(state: string, colors: ReturnType<typeof useColors>) {
  switch (state.toLowerCase()) {
    case "pending": return { bg: colors.warningBackground, fg: colors.warning, label: "Pending review" };
    case "approved": return { bg: colors.primary, fg: colors.primaryForeground, label: "Approved" };
    case "rejected": return { bg: colors.destructive, fg: colors.destructiveForeground, label: "Not approved" };
    default: return null;
  }
}

interface Props {
  businessName: string;
  contactName?: string | null;
  city?: string | null;
  state?: string | null;
  status?: string | null;
  ownerName?: string | null;
  intakeState?: string | null;
  note?: string | null;
  onPress: () => void;
  onLongPress?: () => void;
  converting?: boolean;
}

export function ProspectCard({
  businessName,
  contactName,
  city,
  state,
  status,
  ownerName,
  intakeState,
  note,
  onPress,
  onLongPress,
  converting = false,
}: Props) {
  const colors = useColors();
  const location = [city, state].filter(Boolean).join(", ");
  const subtitle = [contactName, location].filter(Boolean).join(" · ");
  const initials = businessName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const statusKey = (status ?? "new").toLowerCase();
  const statusColor = getStatusColor(statusKey, colors);
  const intakeKey = (intakeState ?? "").toLowerCase();
  const intakeBadge = intakeState ? getIntakeBadge(intakeKey, colors) : null;
  const visibleStatus = intakeBadge?.label ?? status ?? "New";
  const details = [
    subtitle || null,
    `status ${visibleStatus}`,
    ownerName ? `assigned to ${ownerName}` : null,
  ].filter(Boolean).join(", ");

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { backgroundColor: colors.muted, transform: [{ scale: 0.99 }] }
      ]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      onLongPress={onLongPress}
      delayLongPress={350}
      disabled={converting}
      accessibilityRole="button"
      accessibilityLabel={`Prospect ${businessName}, ${details}`}
      accessibilityHint="Double tap to open the prospect profile"
      accessibilityState={{ disabled: converting, busy: converting }}
    >
      <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
        <Text style={[styles.initials, { color: colors.primary }]}>{initials}</Text>
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {businessName}
        </Text>
        {subtitle ? (
          <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {ownerName ? (
          <View style={styles.ownerRow}>
            <Feather name="user" size={12} color={colors.mutedForeground} />
            <Text style={[styles.ownerText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {ownerName}
            </Text>
          </View>
        ) : null}
        {note ? (
          <Text style={[styles.noteText, { color: colors.mutedForeground }]} numberOfLines={2}>
            {note}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        {intakeBadge ? (
          <View
            style={[
              styles.badge,
              intakeBadge.label === "Approved" && styles.approvedBadge,
              { backgroundColor: intakeBadge.bg },
            ]}
          >
            <Text
              style={[
                styles.intakeBadgeText,
                intakeBadge.label === "Approved" && styles.approvedBadgeText,
                { color: intakeBadge.fg },
              ]}
            >
              {intakeBadge.label}
            </Text>
          </View>
        ) : status ? (
          <View style={[styles.badge, { backgroundColor: statusColor.bg }]}>
            <Text style={[styles.badgeText, { color: statusColor.fg }]}>{status}</Text>
          </View>
        ) : null}
        {converting ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} style={{ marginTop: 4 }} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  info: { flex: 1, minWidth: 0, gap: 4, marginTop: -2 },
  name: { fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  metaText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  ownerRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ownerText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  noteText: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, fontStyle: "italic" },
  right: { alignItems: "flex-end", flexShrink: 0, gap: 6, maxWidth: 120 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  intakeBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  approvedBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  approvedBadgeText: { fontSize: 9, letterSpacing: 0.35 },
});