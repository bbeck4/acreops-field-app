import { Feather } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListCommissionLedgerQueryKey,
  getGetMyCompensationPlanQueryKey,
  useListCommissionLedger,
  useGetMyCompensationPlan,
  type CommissionLedgerEntry,
  type MyCompensationPlan,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { useColors } from "@/hooks/useColors";

function formatCents(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRatePerMile(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return `${value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  })}/mi`;
}

function StipendCard({
  plan,
  colors,
}: {
  plan: MyCompensationPlan;
  colors: ReturnType<typeof useColors>;
}) {
  const hasVehicle = (plan.vehicleAllowanceCents ?? 0) > 0;
  const hasPhone = (plan.phoneStipendCents ?? 0) > 0;
  const hasMileage = (plan.mileageRateCents ?? 0) > 0;
  if (!hasVehicle && !hasPhone && !hasMileage) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.stipendHeader}>
        <Feather name="briefcase" size={16} color={colors.primary} />
        <Text style={[styles.stipendTitle, { color: colors.foreground }]}>Plan stipends</Text>
      </View>
      {plan.planName ? (
        <Text style={[styles.planName, { color: colors.mutedForeground }]} numberOfLines={1}>
          {plan.planName}
        </Text>
      ) : null}
      <View style={[styles.metrics, { marginTop: 12 }]}>
        {hasVehicle ? (
          <MetricRow
            label="Vehicle allowance"
            value={`${formatCents(plan.vehicleAllowanceCents)}/mo`}
            colors={colors}
          />
        ) : null}
        {hasPhone ? (
          <MetricRow
            label="Phone stipend"
            value={`${formatCents(plan.phoneStipendCents)}/mo`}
            colors={colors}
          />
        ) : null}
        {hasMileage ? (
          <MetricRow
            label="Mileage rate"
            value={formatRatePerMile(plan.mileageRateCents)}
            colors={colors}
          />
        ) : null}
      </View>
      {hasMileage ? (
        <Text style={[styles.notes, { color: colors.mutedForeground }]}>
          Mileage rate is for reference. Mileage reimbursements are entered by your manager.
        </Text>
      ) : null}
    </View>
  );
}

function formatPeriod(periodMonth: string | null | undefined): string {
  if (!periodMonth) return "—";
  // periodMonth is YYYY-MM-DD (first of the month). Parse as a plain date to
  // avoid timezone shifting the month boundary.
  const [year, month] = periodMonth.split("-");
  if (!year || !month) return periodMonth;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: "#f1f5f9", fg: "#475569" },
  approved: { bg: "#dbeafe", fg: "#1d4ed8" },
  paid: { bg: "#dcfce7", fg: "#15803d" },
};

function StatusBadge({ status }: { status: string }) {
  const palette = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.fg }]}>{status}</Text>
    </View>
  );
}

function MetricRow({
  label,
  value,
  emphasis,
  colors,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.metricRow}>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text
        style={[
          styles.metricValue,
          { color: emphasis ? colors.primary : colors.foreground },
          emphasis ? styles.metricValueEmphasis : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function EntryCard({ entry }: { entry: CommissionLedgerEntry }) {
  const colors = useColors();
  const tierTotal = entry.tierBreakdown.reduce((s, t) => s + t.commissionCents, 0);
  const incentiveTotal = entry.incentivesBreakdown.reduce((s, i) => s + i.commissionCents, 0);
  const bonusTotal = entry.flatBonusesBreakdown.reduce((s, b) => s + b.totalCents, 0);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.period, { color: colors.foreground }]}>
            {formatPeriod(entry.periodMonth)}
          </Text>
          {entry.planName ? (
            <Text style={[styles.planName, { color: colors.mutedForeground }]} numberOfLines={1}>
              {entry.planName}
            </Text>
          ) : null}
        </View>
        <StatusBadge status={entry.status} />
      </View>

      <View style={[styles.total, { backgroundColor: colors.accent }]}>
        <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>
          Total commission
        </Text>
        <Text style={[styles.totalValue, { color: colors.primary }]}>
          {formatCents(entry.totalCommissionCents)}
        </Text>
      </View>

      <View style={styles.metrics}>
        <MetricRow label="Gross sales" value={formatCents(entry.grossSalesCents)} colors={colors} />
        <MetricRow label="Net margin" value={formatCents(entry.netMarginCents)} colors={colors} />
        {tierTotal > 0 ? (
          <MetricRow label="Tier commission" value={formatCents(tierTotal)} colors={colors} />
        ) : null}
        {incentiveTotal > 0 ? (
          <MetricRow
            label="Product incentives"
            value={formatCents(incentiveTotal)}
            colors={colors}
          />
        ) : null}
        {bonusTotal > 0 ? (
          <MetricRow label="Flat bonuses" value={formatCents(bonusTotal)} colors={colors} />
        ) : null}
      </View>

      {entry.guardrailFlags.length > 0 ? (
        <View style={[styles.guardrails, { borderTopColor: colors.border }]}>
          {entry.guardrailFlags.map((flag, idx) => (
            <View key={`${flag.productCategory}-${idx}`} style={styles.guardrailRow}>
              <Feather name="alert-triangle" size={13} color="#b45309" />
              <Text style={[styles.guardrailText, { color: "#b45309" }]} numberOfLines={2}>
                {flag.note ??
                  `${flag.productCategory}: margin ${flag.actualMarginPct}% below ${flag.minMarginPct}% minimum`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {entry.notes ? (
        <Text style={[styles.notes, { color: colors.mutedForeground }]}>{entry.notes}</Text>
      ) : null}
    </View>
  );
}

export default function CommissionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = { self: true } as const;
  const { data: entries, isLoading, refetch, isRefetching } = useListCommissionLedger(params, {
    query: { queryKey: getListCommissionLedgerQueryKey(params) },
  });
  const { data: plan, refetch: refetchPlan } = useGetMyCompensationPlan({
    query: { queryKey: getGetMyCompensationPlanQueryKey() },
  });

  const onRefresh = React.useCallback(() => {
    refetch();
    refetchPlan();
  }, [refetch, refetchPlan]);

  const totalEarned = (entries ?? []).reduce(
    (sum, e) => sum + (e.status === "paid" ? e.totalCommissionCents : 0),
    0,
  );
  const totalPending = (entries ?? []).reduce(
    (sum, e) => sum + (e.status !== "paid" ? e.totalCommissionCents : 0),
    0,
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: "My Commission" }} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>My Commission</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !entries || entries.length === 0 ? (
        <FlatList
          data={[]}
          keyExtractor={() => "none"}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, flexGrow: 1 }}
          refreshing={isRefetching}
          onRefresh={onRefresh}
          renderItem={() => null}
          ListHeaderComponent={plan ? <StipendCard plan={plan} colors={colors} /> : null}
          ListEmptyComponent={
            <View style={styles.center}>
              <EmptyState
                icon="dollar-sign"
                title="No commission yet"
                subtitle="Commission entries posted by your manager will appear here."
              />
            </View>
          }
        />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshing={isRefetching}
          onRefresh={onRefresh}
          ListHeaderComponent={
            <View>
              <View style={styles.summaryRow}>
                <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Paid</Text>
                  <Text style={[styles.summaryValue, { color: "#15803d" }]}>
                    {formatCents(totalEarned)}
                  </Text>
                </View>
                <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Pending</Text>
                  <Text style={[styles.summaryValue, { color: colors.foreground }]}>
                    {formatCents(totalPending)}
                  </Text>
                </View>
              </View>
              {plan ? <StipendCard plan={plan} colors={colors} /> : null}
            </View>
          }
          renderItem={({ item }) => <EntryCard entry={item} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  summaryRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  summaryLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  summaryValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  stipendHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  stipendTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  period: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  planName: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  total: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  totalLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  totalValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  metrics: { gap: 8 },
  metricRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metricLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  metricValue: { fontSize: 14, fontFamily: "Inter_500Medium" },
  metricValueEmphasis: { fontFamily: "Inter_700Bold" },
  guardrails: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, gap: 6 },
  guardrailRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  guardrailText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  notes: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 12, fontStyle: "italic" },
});
