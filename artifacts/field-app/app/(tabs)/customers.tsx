import { Feather } from "@expo/vector-icons";
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
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListCustomersQueryKey,
  getListProspectsQueryKey,
  useListCustomers,
  useListProspects,
} from "@workspace/api-client-react";

import { CustomerCard } from "@/components/CustomerCard";
import { ProspectCard } from "@/components/ProspectCard";
import { EmptyState } from "@/components/EmptyState";
import { OfflineBanner } from "@/components/OfflineBanner";
import { QuickLogFab } from "@/components/QuickLogFab";
import { useAppAuth } from "@/context/AuthContext";
import { useOffline } from "@/context/OfflineContext";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";
import { usePermissions } from "@/lib/permissions";

export default function CustomersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<"customers" | "prospects">("customers");
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(true);
  const { isOnline } = useOffline();
  const { currentMember } = useAppAuth();
  const { canDo } = usePermissions();

  const {
    data: liveCustomers,
    isLoading: loadingCustomers,
    isRefetching: refreshingCustomers,
    refetch: refetchCustomers,
  } = useListCustomers({
    search: search || undefined,
    repId: mineOnly ? currentMember?.id : undefined,
  }, {
    query: {
      enabled: activeTab === "customers",
      queryKey: getListCustomersQueryKey({
        search: search || undefined,
        repId: mineOnly ? currentMember?.id : undefined,
      }),
    },
  });
  const customers = useOfflineCache("customers", liveCustomers, !isOnline);

  const {
    data: liveProspects,
    isLoading: loadingProspects,
    isRefetching: refreshingProspects,
    refetch: refetchProspects,
  } = useListProspects({
    search: search || undefined,
    ownerId: mineOnly ? currentMember?.id : undefined,
  }, {
    query: {
      enabled: activeTab === "prospects",
      queryKey: getListProspectsQueryKey({
        search: search || undefined,
        ownerId: mineOnly ? currentMember?.id : undefined,
      }),
    },
  });
  const prospects = useOfflineCache("prospects", liveProspects, !isOnline);

  const isLoading = activeTab === "customers" ? loadingCustomers : loadingProspects;
  const isRefreshing = activeTab === "customers" ? refreshingCustomers : refreshingProspects;
  const refetch = activeTab === "customers" ? refetchCustomers : refetchProspects;

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
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>Directory</Text>
          <View style={styles.headerActions}>
            <Pressable
              style={[
                styles.toggleBtn,
                { borderColor: colors.border, backgroundColor: mineOnly ? colors.accent : colors.card },
              ]}
              onPress={() => setMineOnly((v) => !v)}
              accessibilityRole="switch"
              accessibilityLabel={`Show only my ${activeTab}`}
              accessibilityState={{ checked: mineOnly }}
            >
              <Feather name="user" size={13} color={mineOnly ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.toggleText, { color: mineOnly ? colors.primary : colors.mutedForeground }]}>
                {mineOnly ? "Mine" : "All"}
              </Text>
            </Pressable>
            {canDo("customers.edit") && activeTab === "customers" && (
              <Pressable
                style={[styles.addBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/customer/new" as never)}
                accessibilityRole="button"
                accessibilityLabel="Add customer"
              >
                <Feather name="plus" size={18} color="#fff" />
              </Pressable>
            )}
            {activeTab === "prospects" && (
              <Pressable
                style={[styles.addBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/prospect/new" as never)}
                accessibilityRole="button"
                accessibilityLabel="Add prospect"
              >
                <Feather name="plus" size={18} color="#fff" />
              </Pressable>
            )}
          </View>
        </View>

        <View style={[styles.segmentControl, { backgroundColor: colors.muted }]}>
          <Pressable
            style={[styles.segmentBtn, activeTab === "customers" && { backgroundColor: colors.card, shadowColor: "#000" }, activeTab === "customers" && styles.segmentBtnActive]}
            onPress={() => setActiveTab("customers")}
            accessibilityRole="radio"
            accessibilityLabel="Show customers"
            accessibilityState={{ selected: activeTab === "customers" }}
          >
            <Text style={[styles.segmentText, { color: activeTab === "customers" ? colors.foreground : colors.mutedForeground }]}>Customers</Text>
          </Pressable>
          <Pressable
            style={[styles.segmentBtn, activeTab === "prospects" && { backgroundColor: colors.card, shadowColor: "#000" }, activeTab === "prospects" && styles.segmentBtnActive]}
            onPress={() => setActiveTab("prospects")}
            accessibilityRole="radio"
            accessibilityLabel="Show prospects"
            accessibilityState={{ selected: activeTab === "prospects" }}
          >
            <Text style={[styles.segmentText, { color: activeTab === "prospects" ? colors.foreground : colors.mutedForeground }]}>Prospects</Text>
          </Pressable>
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
            placeholder={`Search ${activeTab}…`}
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel={`Search ${activeTab}`}
          />
          {search ? (
            <Pressable
              style={styles.clearSearchBtn}
              onPress={() => setSearch("")}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {isLoading && (activeTab === "customers" ? customers === undefined : prospects === undefined) ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : activeTab === "customers" ? (
        <FlatList
          data={customers ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 100 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => { void refetch(); }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="users"
              title={search ? "No matches found" : mineOnly ? "No customers assigned to you" : "No customers yet"}
              subtitle={
                search
                  ? `No customers match "${search}"`
                  : mineOnly
                  ? "Toggle to All to browse and select customers"
                  : "Customers will appear here once added"
              }
            />
          }
          renderItem={({ item }) => (
            <CustomerCard
              id={item.id}
              name={item.name}
              city={item.city}
              state={item.state}
              territory={item.territory}
              phone={item.phone}
              repName={item.repName}
              totalAcres={item.totalAcres}
              onPress={() => router.push(`/customer/${item.id}`)}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          data={prospects ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 100 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => { void refetch(); }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="user-plus"
              title={search ? "No matches found" : mineOnly ? "No prospects assigned to you" : "No prospects yet"}
              subtitle={
                search
                  ? `No prospects match "${search}"`
                  : mineOnly
                  ? "Toggle to All to browse and select prospects"
                  : "Prospects will appear here once added"
              }
            />
          }
          renderItem={({ item }) => (
            <ProspectCard
              businessName={item.businessName}
              contactName={item.contactName}
              city={item.city}
              state={item.state}
              status={item.status}
              ownerName={item.ownerName}
              intakeState={item.intakeState}
              onPress={() => router.push(`/prospect/${item.id}` as never)}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
      <QuickLogFab bottomOffset={insets.bottom + 56} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 16 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 32, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  toggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular" },
  clearSearchBtn: {
    width: 44,
    height: 44,
    marginVertical: -12,
    marginRight: -12,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  segmentControl: {
    flexDirection: "row",
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  segmentBtnActive: {
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 2,
  },
  segmentText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
