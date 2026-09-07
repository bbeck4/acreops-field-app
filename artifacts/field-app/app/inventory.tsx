import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetInventoryAvailabilityQueryKey,
  useGetInventoryAvailability,
  useListInventory,
  useListSites,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { InventoryRow, SiteGroupHeader } from "@/components/InventoryRow";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useOffline } from "@/context/OfflineContext";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function InventoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isOnline } = useOffline();
  const [search, setSearch] = useState("");
  const [nearMe, setNearMe] = useState(false);
  const [memberLoc, setMemberLoc] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem("@agriops:member_location").then((raw) => {
      if (raw) {
        try {
          setMemberLoc(JSON.parse(raw) as { lat: number; lng: number });
        } catch {}
      }
    });
  }, []);

  const { data: liveInventory, isLoading, refetch } = useListInventory({
    search: search || undefined,
  });
  const inventory = useOfflineCache("inventory", liveInventory, !isOnline);

  const { data: sites } = useListSites({ inventoryOnly: true });

  const productIds = useMemo(() => {
    if (!inventory) return "";
    return Array.from(new Set(inventory.map((i) => i.productId))).join(",");
  }, [inventory]);
  const { data: availability } = useGetInventoryAvailability(
    { productIds },
    {
      query: {
        enabled: productIds.length > 0,
        queryKey: getGetInventoryAvailabilityQueryKey({ productIds }),
      },
    },
  );
  const availabilityMap = useMemo(
    () => new Map((availability ?? []).map((a) => [a.productId, a])),
    [availability],
  );

  const siteDistanceMap = useMemo(() => {
    if (!nearMe || !memberLoc || !sites) return null;
    const map = new Map<string, number>();
    for (const site of sites) {
      if (site.lat != null && site.lng != null) {
        map.set(site.name, haversineKm(memberLoc.lat, memberLoc.lng, site.lat, site.lng));
      }
    }
    return map;
  }, [nearMe, memberLoc, sites]);

  const sections = useMemo(() => {
    if (!inventory) return [];
    const map: Record<string, typeof inventory> = {};
    for (const item of inventory) {
      const key = item.siteName || "Unknown Site";
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    const entries = Object.entries(map).map(([siteName, data]) => ({
      siteName,
      siteType: data[0]?.siteType ?? "",
      distanceKm: siteDistanceMap?.get(siteName) ?? Infinity,
      data,
    }));
    if (nearMe && siteDistanceMap && siteDistanceMap.size > 0) {
      entries.sort((a, b) => a.distanceKm - b.distanceKm);
    }
    return entries;
  }, [inventory, nearMe, siteDistanceMap]);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  const hasLocation = memberLoc !== null;

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
          <Pressable onPress={() => router.back()} hitSlop={8} testID="button-back">
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>Inventory</Text>
          <Pressable
            style={[styles.scanBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => router.push("/scan" as never)}
            accessibilityLabel="Scan a product barcode"
          >
            <Feather name="maximize" size={14} color={colors.primary} />
            <Text style={[styles.nearMeText, { color: colors.primary }]}>Scan</Text>
          </Pressable>
          <Pressable
            style={[
              styles.nearMeBtn,
              {
                borderColor: nearMe ? colors.primary : colors.border,
                backgroundColor: nearMe ? colors.accent : colors.card,
              },
            ]}
            onPress={() => setNearMe((v) => !v)}
          >
            <Feather
              name="navigation"
              size={14}
              color={nearMe ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={[styles.nearMeText, { color: nearMe ? colors.primary : colors.mutedForeground }]}
            >
              Near Me
            </Text>
          </Pressable>
        </View>
        {nearMe && !hasLocation ? (
          <Text style={[styles.nearMeHint, { color: colors.mutedForeground }]}>
            Share your location on the Dashboard first to enable proximity sorting
          </Text>
        ) : null}
        <View
          style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search products or sites…"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search ? (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {isLoading && inventory === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : sections.length === 0 ? (
        <EmptyState
          icon="archive"
          title={search ? "No products found" : "No inventory data"}
          subtitle={search ? `No products match "${search}"` : "Inventory levels will appear here"}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.primary} />
          }
          renderSectionHeader={({ section }) => (
            <SiteGroupHeader
              siteName={section.siteName}
              siteType={section.siteType}
              distanceKm={nearMe && section.distanceKm !== Infinity ? section.distanceKm : undefined}
            />
          )}
          renderItem={({ item }) => {
            const av = availabilityMap.get(item.productId);
            return (
              <InventoryRow
                productName={item.productName}
                sku={item.sku}
                quantity={item.quantityOnHand}
                unit={item.unit}
                reorderThreshold={item.reorderThreshold}
                committed={av?.committed}
                available={av?.available}
              />
            );
          }}
          stickySectionHeadersEnabled
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 16 },
  titleRow: { flexDirection: "row", alignItems: "center" },
  title: { fontSize: 32, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  nearMeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: "auto",
    marginRight: 8,
  },
  nearMeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  nearMeHint: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: -4 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    height: 48,
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
