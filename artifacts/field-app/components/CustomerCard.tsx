import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface Props {
  id: number;
  name: string;
  city?: string | null;
  state?: string | null;
  territory?: string | null;
  phone?: string | null;
  repName?: string | null;
  totalAcres?: number | null;
  onPress: () => void;
}

export function CustomerCard({ name, city, state, territory, phone, repName, totalAcres, onPress }: Props) {
  const colors = useColors();
  const location = [city, state].filter(Boolean).join(", ");
  const acreage = totalAcres != null && Number.isFinite(totalAcres) && totalAcres > 0
    ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(totalAcres)} ac`
    : null;
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const details = [
    location || null,
    acreage,
    territory ? `territory ${territory}` : null,
    repName ? `assigned to ${repName}` : null,
    phone ? `phone ${phone}` : null,
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
      accessibilityRole="button"
      accessibilityLabel={`Customer ${name}${details ? `, ${details}` : ""}`}
      accessibilityHint="Double tap to open the customer profile"
    >
      <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
        <Text style={[styles.initials, { color: colors.primary }]}>{initials}</Text>
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {name}
        </Text>
        {[acreage, location, repName].filter(Boolean).length > 0 ? (
          <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {[acreage, location, repName].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        {territory ? (
          <View style={[styles.badge, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>{territory}</Text>
          </View>
        ) : null}
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
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
  info: { flex: 1, gap: 4 },
  name: { fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  metaText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  right: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, textTransform: "uppercase" },
});