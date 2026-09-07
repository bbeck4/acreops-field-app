import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useListWorkOrders } from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { OfflineBanner } from "@/components/OfflineBanner";
import { OrderCard } from "@/components/OrderCard";
import { useColors } from "@/hooks/useColors";
import { usePermissions } from "@/lib/permissions";

const FILTERS = ["All", "Draft", "Submitted", "Fulfilled"] as const;

// A "Draft" work order is shown to users as a "Quote". The filter value sent to
// the API stays "Draft"/"draft"; only the displayed label changes.
const filterLabel = (f: string) => (f === "Draft" ? "Quote" : f);

export default function OrdersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<string>("All");
  const { canDo } = usePermissions();

  const { data: orders, isLoading, refetch } = useListWorkOrders({
    status: filter === "All" ? undefined : filter.toLowerCase(),
  });

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 16, backgroundColor: colors.background },
        ]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>Orders</Text>
          {canDo("work_orders.edit") && (
            <View style={styles.headerActions}>
              <Pressable
                style={[styles.blendBtn, { borderColor: colors.primary }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/blend");
                }}
              >
                <Feather name="droplet" size={16} color={colors.primary} />
                <Text style={[styles.blendBtnText, { color: colors.primary }]}>Blend</Text>
              </Pressable>
              <Pressable
                style={[styles.newBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push("/order/new");
                }}
              >
                <Feather name="plus" size={20} color="#fff" />
              </Pressable>
            </View>
          )}
        </View>
        <View style={styles.filters}>
          {FILTERS.map((f) => (
            <Pressable
              key={f}
              style={[
                styles.filterBtn,
                {
                  borderColor: colors.border,
                  backgroundColor: filter === f ? colors.primary : colors.card,
                },
              ]}
              onPress={() => setFilter(f)}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: filter === f ? "#fff" : colors.mutedForeground },
                ]}
              >
                {filterLabel(f)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {isLoading && !orders ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={orders ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 100 }}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="clipboard"
              title="No orders found"
              subtitle={
                filter !== "All" ? `No ${filterLabel(filter).toLowerCase()} orders` : "Create your first order"
              }
            />
          }
          renderItem={({ item }) => (
            <OrderCard
              id={item.id}
              customerName={item.customerName ?? null}
              status={item.status}
              createdAt={item.createdAt}
              onPress={() => router.push(`/order/${item.id}`)}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 16 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 32, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  blendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  blendBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  newBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  filters: { flexDirection: "row", gap: 10 },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  filterText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
