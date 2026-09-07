import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetMySubmittedProspects } from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { ProspectCard } from "@/components/ProspectCard";
import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

const FILTERS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Not approved" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function intakeOf(state: string | null | undefined): string {
  return (state ?? "").toLowerCase();
}

// Short context line per intake state: rejection reason, allocation on approval,
// or who it's waiting on.
function noteFor(p: {
  intakeState?: string | null;
  rejectionReason?: string | null;
  territory?: string | null;
  ownerName?: string | null;
  suggestedTerritoryName?: string | null;
  suggestedRepName?: string | null;
}): string | null {
  const state = intakeOf(p.intakeState);
  if (state === "rejected") {
    return p.rejectionReason ? `Reason: ${p.rejectionReason}` : "No reason given";
  }
  if (state === "approved") {
    const where = [p.territory, p.ownerName].filter(Boolean).join(" · ");
    return where ? `Allocated to ${where}` : "Approved as a formal prospect";
  }
  // pending
  const suggestion = [p.suggestedTerritoryName, p.suggestedRepName].filter(Boolean).join(" · ");
  return suggestion ? `Suggested: ${suggestion}` : "Waiting for a manager to review";
}

export default function ProspectSubmissionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentMember } = useAppAuth();
  const [filter, setFilter] = useState<FilterKey>("pending");

  const { data: submissions, isLoading, refetch, isRefetching } = useGetMySubmittedProspects();

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const p of submissions ?? []) {
      const state = intakeOf(p.intakeState);
      if (state === "pending" || state === "approved" || state === "rejected") c[state] += 1;
    }
    return c;
  }, [submissions]);

  const visible = useMemo(
    () => (submissions ?? []).filter((p) => intakeOf(p.intakeState) === filter),
    [submissions, filter],
  );

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 8, backgroundColor: colors.background }]}>
        <View style={styles.titleRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Feather name="chevron-left" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>My Submissions</Text>
        </View>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Prospects you submitted and where they stand in review.
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                style={[
                  styles.filterChip,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.accent : colors.card,
                  },
                ]}
                onPress={() => setFilter(f.key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: active ? colors.primary : colors.mutedForeground },
                  ]}
                >
                  {f.label} · {counts[f.key]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 40 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="inbox"
              title={
                filter === "pending"
                  ? "Nothing awaiting review"
                  : filter === "approved"
                  ? "No approved submissions yet"
                  : "No disapproved submissions"
              }
              subtitle={
                filter === "pending"
                  ? "Prospects you submit from the field show up here until a manager reviews them."
                  : filter === "approved"
                  ? "Once a manager approves your prospects, they appear here with their allocation."
                  : "Prospects a manager disapproves appear here with the reason."
              }
            />
          }
          renderItem={({ item }) => {
            const owned =
              item.ownerId == null || item.ownerId === currentMember?.id;
            return (
              <ProspectCard
                businessName={item.businessName}
                contactName={item.contactName}
                city={item.city}
                state={item.state}
                ownerName={null}
                intakeState={item.intakeState}
                note={noteFor(item)}
                onPress={() => {
                  if (owned) router.push(`/prospect/${item.id}`);
                }}
              />
            );
          }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  backBtn: { padding: 2, marginLeft: -6 },
  title: { flex: 1, fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  filterRow: { gap: 8, paddingRight: 16, paddingTop: 4 },
  filterChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  filterChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
