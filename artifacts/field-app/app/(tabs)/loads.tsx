import { useUser } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useMemo } from "react";
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

import {
  getListDeliveryLoadsQueryKey,
  useListDeliveryLoads,
  useListMembers,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useColors } from "@/hooks/useColors";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const STOP_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  planned: { bg: "#e7e7db", fg: "#6b756c" },
  en_route: { bg: "#dbeafe", fg: "#1d4ed8" },
  delivered: { bg: "#dcfce7", fg: "#15803d" },
  refused: { bg: "#fef3c7", fg: "#92400e" },
  incident: { bg: "#fee2e2", fg: "#991b1b" },
  cancelled: { bg: "#f3f4f6", fg: "#6b7280" },
};

export default function LoadsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const date = todayIso();

  const { data: members } = useListMembers();
  const myMember = useMemo(
    () =>
      (members ?? []).find(
        (m) => m.email && user?.primaryEmailAddress?.emailAddress === m.email,
      ),
    [members, user],
  );

  const {
    data: loads,
    isLoading,
    refetch,
    isRefetching,
  } = useListDeliveryLoads(
    { date, driverId: myMember?.id },
    {
      query: {
        queryKey: getListDeliveryLoadsQueryKey({ date, driverId: myMember?.id }),
        enabled: !!myMember?.id,
        refetchInterval: 30_000,
      },
    },
  );

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <View style={[styles.header, { paddingTop: topPadding + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>My loads today</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {new Date(date).toLocaleDateString(undefined, {
            weekday: "long",
            month: "short",
            day: "numeric",
          })}
        </Text>
      </View>

      {!myMember && !isLoading ? (
        <View style={styles.center}>
          <EmptyState
            icon="user"
            title="Driver profile not found"
            subtitle="Ask your dispatcher to set up your driver account."
          />
        </View>
      ) : isLoading && !loads ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={loads ?? []}
          keyExtractor={(l) => String(l.id)}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: insets.bottom + 100,
            gap: 14,
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="truck"
              title="No loads assigned"
              subtitle="When dispatch builds a load for you, it'll show up here."
            />
          }
          renderItem={({ item: load }) => {
            const remaining = load.stops.filter(
              (s) => s.status !== "delivered" && s.status !== "cancelled",
            ).length;
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/load/${load.id}`);
                }}
                testID={`load-${load.id}`}
              >
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                      {load.truck ?? "Unassigned truck"}
                    </Text>
                    <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                      {load.stops.length} stop{load.stops.length === 1 ? "" : "s"} ·{" "}
                      {remaining} to go
                      {load.plannedWindowEnd
                        ? ` · due ${new Date(load.plannedWindowEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                        : ""}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={22} color={colors.mutedForeground} />
                </View>
                <View style={styles.stopsList}>
                  {load.stops.slice(0, 5).map((s) => {
                    const sc =
                      STOP_STATUS_COLORS[s.status] ?? STOP_STATUS_COLORS.planned;
                    return (
                      <View key={s.id} style={styles.stopRow}>
                        <Text style={[styles.stopOrder, { color: colors.mutedForeground }]}>
                          {s.stopOrder}
                        </Text>
                        <Text
                          style={[styles.stopName, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {s.customerName ?? "Customer"}
                        </Text>
                        <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                          <Text style={[styles.statusText, { color: sc.fg }]}>
                            {s.status}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                  {load.stops.length > 5 && (
                    <Text
                      style={[styles.moreText, { color: colors.mutedForeground }]}
                    >
                      +{load.stops.length - 5} more
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: 32, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  subtitle: { fontSize: 15, marginTop: 4, fontFamily: "Inter_500Medium" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 20,
    gap: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitle: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  cardSub: { fontSize: 14, marginTop: 4, fontFamily: "Inter_500Medium" },
  stopsList: { gap: 8 },
  stopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stopOrder: { fontSize: 13, width: 20, fontFamily: "Inter_700Bold" },
  stopName: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  moreText: { fontSize: 13, fontStyle: "italic", marginTop: 4, fontFamily: "Inter_500Medium" },
});
