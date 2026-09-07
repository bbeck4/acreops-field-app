import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListBlanketAllocationsQueryKey,
  useCancelBlanketAllocation,
  useDismissAllBlanketAllocations,
  useDismissBlanketAllocation,
  useListBlanketAllocations,
  useRestoreBlanketAllocation,
  type BlanketAllocation,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { useColors } from "@/hooks/useColors";

function fmtQty(value: number | null | undefined): string {
  const n = value ?? 0;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const TERMINAL = new Set(["approved", "denied", "cancelled"]);

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "#fef3c7", fg: "#b45309" },
  approved: { bg: "#dcfce7", fg: "#15803d" },
  denied: { bg: "#fee2e2", fg: "#b91c1c" },
  cancelled: { bg: "#f1f5f9", fg: "#475569" },
};

function StatusBadge({ status }: { status: string }) {
  const palette = STATUS_COLORS[status] ?? STATUS_COLORS.cancelled;
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.fg }]}>{status}</Text>
    </View>
  );
}

function tap() {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export default function AllocationRequestsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // Always fetch everything (including hidden) so the "Show hidden" toggle stays
  // reachable even when every request is hidden; filter for display client-side.
  const params = { self: true, includeDismissed: true } as const;
  const { data, isLoading, refetch, isRefetching } = useListBlanketAllocations(params, {
    query: { queryKey: getListBlanketAllocationsQueryKey(params) },
  });

  const cancelAllocation = useCancelBlanketAllocation();
  const dismissAllocation = useDismissBlanketAllocation();
  const dismissAll = useDismissAllBlanketAllocations();
  const restoreAllocation = useRestoreBlanketAllocation();

  const [showHidden, setShowHidden] = useState(false);

  const allocations = useMemo(() => data ?? [], [data]);
  const hiddenCount = useMemo(
    () => allocations.filter((a) => a.dismissedAt).length,
    [allocations],
  );
  const visible = useMemo(
    () => (showHidden ? allocations : allocations.filter((a) => !a.dismissedAt)),
    [allocations, showHidden],
  );
  // Decided (terminal) requests that aren't hidden yet — eligible for "Hide all".
  const dismissableCount = useMemo(
    () => allocations.filter((a) => !a.dismissedAt && TERMINAL.has(a.status)).length,
    [allocations],
  );

  const cancelMy = (id: number) => {
    tap();
    cancelAllocation.mutate(
      { id },
      {
        onSuccess: () => refetch(),
        onError: () => Alert.alert("Error", "Failed to withdraw request."),
      },
    );
  };

  const dismissMy = (id: number) => {
    tap();
    dismissAllocation.mutate(
      { id },
      {
        onSuccess: () => refetch(),
        onError: () => Alert.alert("Error", "Failed to hide request."),
      },
    );
  };

  const restoreMy = (id: number) => {
    tap();
    restoreAllocation.mutate(
      { id },
      {
        onSuccess: () => refetch(),
        onError: () => Alert.alert("Error", "Failed to restore request."),
      },
    );
  };

  const hideAllDecided = () => {
    tap();
    dismissAll.mutate(undefined, {
      onSuccess: () => refetch(),
      onError: () => Alert.alert("Error", "Failed to hide requests."),
    });
  };

  const renderItem = ({ item: a }: { item: BlanketAllocation }) => {
    const isTerminal = TERMINAL.has(a.status);
    const sellLine =
      a.status === "approved" && a.unitSellPriceCents != null
        ? ` · sell $${(a.unitSellPriceCents / 100).toFixed(2)}/${a.unit ?? "unit"}`
        : "";
    const meta = [
      a.customerName ?? "No customer",
      a.workOrderNumber ? `Quote ${a.workOrderNumber}` : null,
      a.blanketNumber ? `Blanket ${a.blanketNumber}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <View
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {(a.productName ?? "Product") + " · " + fmtQty(a.requestedQty) + " " + (a.unit ?? "units")}
            </Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {meta}
              {sellLine}
            </Text>
            {a.decisionNote ? (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                {"\u201C" + a.decisionNote + "\u201D"}
              </Text>
            ) : null}
          </View>
          <StatusBadge status={a.status} />
        </View>

        <View style={styles.actions}>
          {a.status === "pending" ? (
            <Pressable
              hitSlop={8}
              onPress={() => cancelMy(a.id)}
              disabled={cancelAllocation.isPending}
            >
              <Text style={[styles.actionText, { color: colors.destructive }]}>Withdraw</Text>
            </Pressable>
          ) : null}
          {isTerminal && !a.dismissedAt ? (
            <Pressable
              hitSlop={8}
              onPress={() => dismissMy(a.id)}
              disabled={dismissAllocation.isPending}
            >
              <Text style={[styles.actionText, { color: colors.mutedForeground }]}>Hide</Text>
            </Pressable>
          ) : null}
          {a.dismissedAt ? (
            <Pressable
              hitSlop={8}
              onPress={() => restoreMy(a.id)}
              disabled={restoreAllocation.isPending}
            >
              <Text style={[styles.actionText, { color: colors.primary }]}>Restore</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: "Allocation Requests" }} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Allocation Requests</Text>
        <View style={{ width: 24 }} />
      </View>

      {(dismissableCount > 0 || hiddenCount > 0) && !isLoading ? (
        <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
          {dismissableCount > 0 ? (
            <Pressable hitSlop={8} onPress={hideAllDecided} disabled={dismissAll.isPending}>
              <Text style={[styles.toolbarText, { color: colors.mutedForeground }]}>
                {`Hide all decided (${dismissableCount})`}
              </Text>
            </Pressable>
          ) : (
            <View />
          )}
          {hiddenCount > 0 ? (
            <Pressable hitSlop={8} onPress={() => setShowHidden((v) => !v)}>
              <Text style={[styles.toolbarText, { color: colors.primary }]}>
                {showHidden ? "Hide hidden" : `Show hidden (${hiddenCount})`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : allocations.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="layers"
            title="No allocation requests"
            subtitle="Blanket allocation requests you submit will appear here."
          />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshing={isRefetching}
          onRefresh={refetch}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.allHidden, { color: colors.mutedForeground }]}>
                All requests are hidden. Use “Show hidden” to view them.
              </Text>
            </View>
          }
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
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  toolbarText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  allHidden: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start" },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  note: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, fontStyle: "italic" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 18, marginTop: 12 },
  actionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
});
