import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useConvertProspect,
  useGetMySubmittedProspects,
  useListProspects,
  useListProspectLeadSources,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ProspectCard } from "@/components/ProspectCard";
import { useAppAuth } from "@/context/AuthContext";
import { useOffline } from "@/context/OfflineContext";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";

const STATUSES = ["new", "contacted", "qualified", "nurturing", "lost", "converted"] as const;

export default function ProspectsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [leadSource, setLeadSource] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(true);
  const { isOnline } = useOffline();
  const { currentMember } = useAppAuth();

  const [convertingId, setConvertingId] = useState<number | null>(null);

  const { data: liveProspects, isLoading, refetch } = useListProspects({
    search: search || undefined,
    status: status ?? undefined,
    leadSource: leadSource ?? undefined,
    ownerId: mineOnly ? currentMember?.id : undefined,
  });
  const prospects = useOfflineCache("prospects", liveProspects, !isOnline);
  const { data: leadSources } = useListProspectLeadSources();
  const { mutateAsync: convertMutation } = useConvertProspect();

  const { data: mySubmissions } = useGetMySubmittedProspects();
  const pendingCount = (mySubmissions ?? []).filter(
    (p) => (p.intakeState ?? "").toLowerCase() === "pending",
  ).length;

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  const runConvert = async (prospectId: number) => {
    setConvertingId(prospectId);
    try {
      const res = await convertMutation({ id: prospectId });
      await refetch();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Prospect converted", "A new customer has been created.", [
        { text: "Not now", style: "cancel" },
        {
          text: "View customer",
          onPress: () => router.push(`/customer/${res.customerId}` as never),
        },
      ]);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Conversion failed", "Could not convert this prospect. Please try again.");
    } finally {
      setConvertingId(null);
    }
  };

  const confirmConvert = (prospectId: number) => {
    if (convertingId !== null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Convert to customer?",
      "This will copy contact info, create fields from crops, copy activities, and re-point open tasks.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Convert", style: "default", onPress: () => runConvert(prospectId) },
      ],
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 8, backgroundColor: colors.background },
        ]}
      >
        <View style={styles.titleRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Feather name="chevron-left" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>Prospects</Text>
          <View style={styles.headerActions}>
            <Pressable
              style={[
                styles.toggleBtn,
                { borderColor: colors.border, backgroundColor: mineOnly ? colors.accent : colors.card },
              ]}
              onPress={() => setMineOnly((v) => !v)}
            >
              <Feather name="user" size={13} color={mineOnly ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.toggleText, { color: mineOnly ? colors.primary : colors.mutedForeground }]}>
                {mineOnly ? "Mine" : "All"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.addBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push("/prospect/new" as never)}
            >
              <Feather name="plus" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
        <View
          style={[
            styles.searchBar,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search prospects…"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {search ? (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statusRow}
        >
          <Pressable
            style={[
              styles.statusChip,
              {
                borderColor: status === null ? colors.primary : colors.border,
                backgroundColor: status === null ? colors.accent : colors.card,
              },
            ]}
            onPress={() => setStatus(null)}
          >
            <Text
              style={[
                styles.statusChipText,
                { color: status === null ? colors.primary : colors.mutedForeground },
              ]}
            >
              All
            </Text>
          </Pressable>
          {STATUSES.map((s) => {
            const active = status === s;
            return (
              <Pressable
                key={s}
                style={[
                  styles.statusChip,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.accent : colors.card,
                  },
                ]}
                onPress={() => setStatus(active ? null : s)}
              >
                <Text
                  style={[
                    styles.statusChipText,
                    { color: active ? colors.primary : colors.mutedForeground },
                  ]}
                >
                  {s}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {leadSources && leadSources.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.statusRow}
          >
            <Pressable
              style={[
                styles.statusChip,
                {
                  borderColor: leadSource === null ? colors.primary : colors.border,
                  backgroundColor: leadSource === null ? colors.accent : colors.card,
                },
              ]}
              onPress={() => setLeadSource(null)}
            >
              <Text
                style={[
                  styles.statusChipText,
                  { color: leadSource === null ? colors.primary : colors.mutedForeground },
                ]}
              >
                All sources
              </Text>
            </Pressable>
            {leadSources.map((s) => {
              const active = leadSource === s.name;
              return (
                <Pressable
                  key={s.id}
                  style={[
                    styles.statusChip,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.accent : colors.card,
                    },
                  ]}
                  onPress={() => setLeadSource(active ? null : s.name)}
                >
                  <Text
                    style={[
                      styles.sourceChipText,
                      { color: active ? colors.primary : colors.mutedForeground },
                    ]}
                  >
                    {s.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      <Pressable
        style={[styles.subBanner, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push("/prospects/submissions" as never)}
      >
        <View style={[styles.subBannerIcon, { backgroundColor: colors.accent }]}>
          <Feather name="inbox" size={15} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.subBannerTitle, { color: colors.foreground }]}>My submissions</Text>
          <Text style={[styles.subBannerSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {pendingCount > 0
              ? `${pendingCount} awaiting approval`
              : "Track approval status of prospects you submit"}
          </Text>
        </View>
        {pendingCount > 0 ? (
          <View style={[styles.subBannerBadge, { backgroundColor: "#fef3c7" }]}>
            <Text style={styles.subBannerBadgeText}>{pendingCount}</Text>
          </View>
        ) : null}
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </Pressable>

      {isLoading && prospects === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={prospects ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 40 }}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="user-plus"
              title={
                search || status || leadSource
                  ? "No matches found"
                  : mineOnly
                  ? "No prospects assigned to you"
                  : "No prospects yet"
              }
              subtitle={
                search
                  ? `No prospects match "${search}"`
                  : leadSource
                  ? `No prospects from ${leadSource}`
                  : status
                  ? `No ${status} prospects`
                  : mineOnly
                  ? "Toggle to All to browse the whole pipeline"
                  : "Prospects will appear here once added"
              }
            />
          }
          renderItem={({ item }) => {
            const isConverted = item.status?.toLowerCase() === "converted";
            return (
              <ProspectCard
                businessName={item.businessName}
                contactName={item.contactName}
                city={item.city}
                state={item.state}
                status={item.status}
                ownerName={item.ownerName}
                onPress={() => router.push(`/prospect/${item.id}`)}
                onLongPress={isConverted ? undefined : () => confirmConvert(item.id)}
                converting={convertingId === item.id}
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
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  backBtn: { padding: 2, marginLeft: -6 },
  title: { flex: 1, fontSize: 28, fontFamily: "Inter_700Bold" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  toggleText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  subBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  subBannerIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  subBannerTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  subBannerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  subBannerBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  subBannerBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#b45309" },
  statusRow: { gap: 8, paddingRight: 16 },
  statusChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  statusChipText: { fontSize: 13, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  sourceChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
