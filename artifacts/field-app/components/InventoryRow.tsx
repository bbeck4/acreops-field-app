import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { formatDistance, useDistanceUnit } from "@/lib/units";

interface RowProps {
  productName: string;
  sku: string;
  quantity: number;
  unit: string;
  reorderThreshold: number;
  committed?: number;
  available?: number;
}

export function InventoryRow({
  productName,
  sku,
  quantity,
  unit,
  reorderThreshold,
  committed,
  available,
}: RowProps) {
  const colors = useColors();
  const isLow = quantity <= reorderThreshold;
  const hasCommit = typeof committed === "number" && committed > 0;
  const isShort = typeof available === "number" && available < 0;

  return (
    <View style={[styles.container, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {productName}
        </Text>
        <Text style={[styles.sku, { color: colors.mutedForeground }]}>{sku}</Text>
        {hasCommit ? (
          <Text
            style={[
              styles.commitLine,
              { color: isShort ? colors.destructive : colors.mutedForeground },
            ]}
          >
            {committed} committed · {available} available
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        <Text style={[styles.qty, { color: isLow ? colors.destructive : colors.foreground }]}>
          {quantity}{" "}
          <Text style={[styles.unit, { color: colors.mutedForeground }]}>{unit}</Text>
        </Text>
        {isLow || isShort ? (
          <View style={[styles.badge, { backgroundColor: colors.destructive }]}>
            <Text style={[styles.badgeText, { color: colors.destructiveForeground }]}>{isShort ? "Oversold" : "Low Stock"}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface GroupHeaderProps {
  siteName: string;
  siteType: string;
  distanceKm?: number;
}

export function SiteGroupHeader({ siteName, siteType, distanceKm }: GroupHeaderProps) {
  const colors = useColors();
  const unit = useDistanceUnit();
  const distLabel = distanceKm !== undefined ? formatDistance(distanceKm, unit) : null;
  return (
    <View style={[styles.groupHeader, { backgroundColor: colors.muted, borderTopColor: colors.border, borderBottomColor: colors.border }]}>
      <Text style={[styles.groupName, { color: colors.foreground }]}>{siteName}</Text>
      <View style={styles.groupRight}>
        {distLabel ? (
          <View style={[styles.distBadge, { backgroundColor: colors.card }]}>
            <Feather name="navigation" size={12} color={colors.primary} />
            <Text style={[styles.groupDist, { color: colors.primary }]}>{distLabel}</Text>
          </View>
        ) : null}
        <Text style={[styles.groupType, { color: colors.mutedForeground }]}>{siteType}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  info: { flex: 1, gap: 4 },
  name: { fontSize: 16, fontFamily: "Inter_600SemiBold", letterSpacing: -0.2 },
  sku: { fontSize: 13, fontFamily: "Inter_500Medium" },
  right: { alignItems: "flex-end", gap: 6 },
  qty: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  unit: { fontSize: 14, fontFamily: "Inter_500Medium" },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  commitLine: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  groupRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  groupName: { fontSize: 14, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  groupType: { fontSize: 13, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  distBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  groupDist: { fontSize: 12, fontFamily: "Inter_700Bold" },
});