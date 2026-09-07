import * as Haptics from "expo-haptics";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";

interface Props {
  id: number;
  customerName?: string | null;
  status: string;
  itemCount?: number;
  total?: number | null;
  createdAt: string;
  onPress?: () => void;
}

function getStatusStyle(status: string, colors: ReturnType<typeof useColors>) {
  switch (status.toLowerCase()) {
    case "draft": return { bg: colors.muted, fg: colors.mutedForeground, icon: "edit-2" as const };
    case "submitted": return { bg: colors.secondary, fg: colors.secondaryForeground, icon: "send" as const };
    case "fulfilled": return { bg: colors.primary, fg: colors.primaryForeground, icon: "check-circle" as const };
    case "cancelled": return { bg: colors.destructive, fg: colors.destructiveForeground, icon: "x-circle" as const };
    default: return { bg: colors.muted, fg: colors.mutedForeground, icon: "edit-2" as const };
  }
}

export function OrderCard({ id, customerName, status, itemCount, total, createdAt, onPress }: Props) {
  const colors = useColors();
  const statusStyle = getStatusStyle(status, colors);
  const date = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { backgroundColor: colors.muted, transform: [{ scale: 0.99 }] }
      ]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
    >
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Text style={[styles.customer, { color: colors.foreground }]} numberOfLines={1}>
            {customerName ?? `Order #${id}`}
          </Text>
          <Text style={[styles.orderId, { color: colors.mutedForeground }]}>#{id}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
          <Feather name={statusStyle.icon} size={10} color={statusStyle.fg} />
          <Text style={[styles.statusText, { color: statusStyle.fg }]}>
            {status.toLowerCase() === "draft" ? "Quote" : status}
          </Text>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.footer}>
        <View style={styles.metaRow}>
          <Feather name="calendar" size={14} color={colors.mutedForeground} />
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{date}</Text>
          {itemCount != null ? (
            <>
              <View style={[styles.dot, { backgroundColor: colors.mutedForeground }]} />
              <Feather name="package" size={14} color={colors.mutedForeground} />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{itemCount} items</Text>
            </>
          ) : null}
        </View>
        {total != null && total > 0 ? (
          <Text style={[styles.total, { color: colors.foreground }]}>${total.toFixed(2)}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    marginHorizontal: 16,
    marginBottom: 10,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  titleWrap: { flex: 1, gap: 2 },
  customer: { fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  orderId: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  divider: { height: 1, opacity: 0.5 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { fontSize: 13, fontFamily: "Inter_500Medium" },
  dot: { width: 3, height: 3, borderRadius: 1.5, marginHorizontal: 2 },
  total: { fontSize: 16, fontFamily: "Inter_700Bold" },
});