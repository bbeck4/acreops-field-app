import { Feather } from "@expo/vector-icons";
import React from "react";
import { Alert, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { usePrivacy } from "@/context/PrivacyContext";

const AMBER = "#b45309";
const AMBER_BG = "rgba(245, 158, 11, 0.15)";

export interface MarginFloorInfo {
  belowMarginFloor?: boolean | null;
  marginPct?: number | null;
  marginFloorPct?: number | null;
  marginFloorSource?: "product" | "category" | null;
}

export function isBelowMarginFloor(info: MarginFloorInfo | null | undefined): boolean {
  return info?.belowMarginFloor === true;
}

export function marginFloorMessage(info: MarginFloorInfo): string | null {
  if (!info.belowMarginFloor) return null;
  const margin = info.marginPct != null ? `${info.marginPct.toFixed(1)}%` : "—";
  const floor = info.marginFloorPct != null ? `${info.marginFloorPct.toFixed(1)}%` : "—";
  const source = info.marginFloorSource === "product" ? "product" : "category";
  return `Margin ${margin} is below the ${source} floor of ${floor}.`;
}

export function LowMarginBadge({ style }: { style?: StyleProp<ViewStyle> }) {
  const { customerMode } = usePrivacy();
  if (customerMode) return null;
  return (
    <View style={[styles.badge, style]} accessibilityLabel="Low margin">
      <Feather name="alert-triangle" size={11} color={AMBER} />
      <Text style={styles.badgeText}>Low margin</Text>
    </View>
  );
}

export function MarginFloorWarning({
  info,
  style,
}: {
  info: MarginFloorInfo;
  style?: StyleProp<ViewStyle>;
}) {
  const { customerMode } = usePrivacy();
  const message = marginFloorMessage(info);
  if (!message || customerMode) return null;
  return (
    <View style={[styles.warning, style]}>
      <Feather name="alert-triangle" size={13} color={AMBER} style={styles.warningIcon} />
      <Text style={styles.warningText}>{message}</Text>
    </View>
  );
}

export interface MarginLineInput extends MarginFloorInfo {
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  cost?: number | null;
}

export interface OrderMarginSummary {
  blendedMarginPct: number | null;
  belowFloorCount: number;
}

export function computeOrderMarginSummary(items: MarginLineInput[]): OrderMarginSummary {
  let revenue = 0;
  let cost = 0;
  for (const it of items) {
    const qty = Number(it.quantity ?? 0);
    const lineRev =
      it.totalPrice != null ? Number(it.totalPrice) : qty * Number(it.unitPrice ?? 0);
    const unitCost = Number(it.cost ?? 0);
    revenue += lineRev;
    cost += (unitCost > 0 ? unitCost : 0) * qty;
  }
  const blendedMarginPct = revenue > 0 ? ((revenue - cost) / revenue) * 100 : null;
  const belowFloorCount = items.filter((it) => it.belowMarginFloor === true).length;
  return { blendedMarginPct, belowFloorCount };
}

export function thinMarginWarning(
  items: MarginLineInput[],
): { title: string; message: string } | null {
  const { blendedMarginPct, belowFloorCount } = computeOrderMarginSummary(items);
  if (belowFloorCount === 0) return null;
  const lineLabel =
    belowFloorCount === 1
      ? "1 line is below the margin floor"
      : `${belowFloorCount} lines are below the margin floor`;
  const blended =
    blendedMarginPct != null ? ` Blended margin is ${blendedMarginPct.toFixed(1)}%.` : "";
  return {
    title: "Thin-margin deal",
    message: `${lineLabel}.${blended}`,
  };
}

// Advisory confirmation shown before submitting/saving a thin-margin order.
// Resolves true to proceed (no warning needed, or the rep confirmed), false to
// cancel. Never a hard block — consistent with the advisory margin-floor policy.
export function confirmThinMargin(
  items: MarginLineInput[],
  proceedLabel: string,
): Promise<boolean> {
  const warning = thinMarginWarning(items);
  if (!warning) return Promise.resolve(true);
  return new Promise((resolve) => {
    Alert.alert(warning.title, `${warning.message}\n\nDo you want to ${proceedLabel.toLowerCase()} anyway?`, [
      { text: "Review", style: "cancel", onPress: () => resolve(false) },
      { text: proceedLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

export function OrderMarginSummaryRow({
  items,
  colors,
  style,
}: {
  items: MarginLineInput[];
  colors: { foreground: string; mutedForeground: string };
  style?: StyleProp<ViewStyle>;
}) {
  const { customerMode } = usePrivacy();
  const { blendedMarginPct, belowFloorCount } = computeOrderMarginSummary(items);
  // Costs come back via the eye toggle on the dashboard, not here.
  if (customerMode) return null;
  if (blendedMarginPct == null && belowFloorCount === 0) return null;
  const amber = belowFloorCount > 0;
  return (
    <View style={[styles.summaryWrap, style]}>
      {blendedMarginPct != null ? (
        <View style={styles.summaryRow}>
          <View style={styles.summaryLabelWrap}>
            {amber ? (
              <Feather name="alert-triangle" size={12} color={AMBER} />
            ) : null}
            <Text
              style={[
                styles.summaryLabel,
                { color: amber ? AMBER : colors.mutedForeground },
              ]}
            >
              Blended margin
            </Text>
          </View>
          <Text
            style={[
              styles.summaryValue,
              { color: amber ? AMBER : colors.foreground },
            ]}
          >
            {blendedMarginPct.toFixed(1)}%
          </Text>
        </View>
      ) : null}
      {belowFloorCount > 0 ? (
        <Text style={styles.summaryNote}>
          {belowFloorCount} line{belowFloorCount !== 1 ? "s" : ""} below margin floor
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: AMBER_BG,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: AMBER },
  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 5,
    marginTop: 4,
  },
  warningIcon: { marginTop: 1 },
  warningText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: AMBER, lineHeight: 16 },
  summaryWrap: { marginTop: 8, gap: 2 },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabelWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
  summaryLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  summaryValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  summaryNote: { fontSize: 12, fontFamily: "Inter_400Regular", color: AMBER, textAlign: "right" },
});
