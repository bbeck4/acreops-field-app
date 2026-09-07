import { Feather } from "@expo/vector-icons";
import { useQueries } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AgRecommendation,
  getListFieldRecommendationsQueryOptions,
  useGetCustomer,
  useListCustomerFields,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { useColors } from "@/hooks/useColors";

export default function CustomerRecommendationsScreen() {
  const { customerId: cidParam } = useLocalSearchParams<{ customerId: string }>();
  const customerId = parseInt(cidParam ?? "0", 10);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { data: customer } = useGetCustomer(customerId);
  const { data: fields, isLoading: fieldsLoading } = useListCustomerFields(customerId);

  const fieldList = fields ?? [];

  const recQueries = useQueries({
    queries: fieldList.map((f) => getListFieldRecommendationsQueryOptions(f.id)),
  });

  const isRefetching = recQueries.some((q) => q.isFetching && !q.isLoading);
  const onRefresh = async () => {
    await Promise.all(recQueries.map((q) => q.refetch()));
  };

  const sections = useMemo(
    () =>
      fieldList.map((f, idx) => {
        const q = recQueries[idx];
        const accepted = (q?.data ?? []).filter((r) => r.status === "accepted");
        return {
          fieldId: f.id,
          fieldName: f.name,
          accepted,
          isLoading: q?.isLoading ?? false,
          isError: q?.isError ?? false,
        };
      }),
    [fieldList, recQueries],
  );

  const allLoaded = sections.length > 0 && sections.every((s) => !s.isLoading);
  const totalAccepted = sections.reduce((sum, s) => sum + s.accepted.length, 0);
  const anyError = sections.some((s) => s.isError);
  const visibleSections = sections.filter((s) => s.accepted.length > 0 || s.isLoading);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <Stack.Screen options={{ title: "Recommendations" }} />

      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            Accepted Prescriptions
          </Text>
          {customer?.name ? (
            <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              {customer.name}
            </Text>
          ) : null}
        </View>
      </View>

      {fieldsLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : fieldList.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState
            icon="map"
            title="No precision ag fields"
            subtitle="Add fields for this customer in the web platform first"
          />
        </View>
      ) : allLoaded && totalAccepted === 0 && !anyError ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState
            icon="inbox"
            title="No accepted prescriptions yet"
            subtitle="Generate and accept a fertilizer recommendation on the web platform to see it here"
          />
        </View>
      ) : (
        <FlatList
          data={visibleSections}
          keyExtractor={(s) => String(s.fieldId)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            anyError ? (
              <View
                style={[
                  styles.errorBanner,
                  { backgroundColor: colors.muted, borderColor: colors.border },
                ]}
              >
                <Feather name="alert-triangle" size={14} color={colors.mutedForeground} />
                <Text style={[styles.errorBannerText, { color: colors.mutedForeground }]}>
                  Some fields couldn't load. Pull to refresh or check your connection.
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <FieldSection
              fieldName={item.fieldName}
              accepted={item.accepted}
              isLoading={item.isLoading}
            />
          )}
        />
      )}
    </View>
  );
}

function FieldSection({
  fieldName,
  accepted,
  isLoading,
}: {
  fieldName: string;
  accepted: AgRecommendation[];
  isLoading: boolean;
}) {
  const colors = useColors();
  return (
    <View>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{fieldName}</Text>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
      ) : (
        <View style={{ gap: 8 }}>
          {accepted.map((rec) => (
            <RecommendationRow key={rec.id} rec={rec} />
          ))}
        </View>
      )}
    </View>
  );
}

function RecommendationRow({ rec }: { rec: AgRecommendation }) {
  const colors = useColors();
  const reviewed = rec.reviewedAt ? new Date(rec.reviewedAt).toLocaleDateString() : null;
  return (
    <Pressable
      onPress={() => router.push(`/recommendation/${rec.id}` as never)}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      testID={`rec-row-${rec.id}`}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>
          {rec.cropTarget ?? "Recommendation"}
          {rec.season ? ` · ${rec.season}` : ""}
        </Text>
        <Text style={[styles.cardMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {rec.yieldGoal != null
            ? `${rec.yieldGoal} ${rec.yieldGoalUnit ?? "bu/ac"}`
            : "Accepted prescription"}
          {reviewed ? ` · reviewed ${reviewed}` : ""}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  headerSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cardMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  errorBannerText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
});
