// Product catalog browser — a full-screen list of every product with search.
// Tapping a product opens the existing product detail screen (pricing,
// availability by site). Reached from the dashboard "Products" quick action.
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListProductsQueryKey,
  useListProducts,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useColors } from "@/hooks/useColors";

export default function ProductsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");

  const { data: products, isLoading } = useListProducts(
    { search: search || undefined },
    { query: { queryKey: getListProductsQueryKey({ search: search || undefined }) } },
  );

  // Group filter chips: every product group present in the catalog.
  const [lineFilter, setLineFilter] = useState<string | null>(null);
  const groupNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of products ?? []) names.add(p.productLineName ?? "Ungrouped");
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [products]);

  // Products organized by group (product line), alphabetical within each group.
  const sections = useMemo(() => {
    const filtered = (products ?? []).filter(
      (p) => lineFilter == null || (p.productLineName ?? "Ungrouped") === lineFilter,
    );
    const byLine = new Map<string, typeof filtered>();
    for (const p of filtered) {
      const key = p.productLineName ?? "Ungrouped";
      const arr = byLine.get(key);
      if (arr) arr.push(p);
      else byLine.set(key, [p]);
    }
    return [...byLine.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, data]) => ({
        title,
        data: data.slice().sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [products, lineFilter]);
  const itemCount = sections.reduce((n, s) => n + s.data.length, 0);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: topPadding }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} testID="button-back">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Products</Text>
        <View style={{ width: 22 }} />
      </View>
      <OfflineBanner />
      <View style={styles.searchWrap}>
        <View
          style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search by name, SKU, or barcode…"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
            testID="input-product-search"
          />
          {search ? (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {groupNames.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, height: 44 }}
          contentContainerStyle={styles.chipRow}
        >
          {[null, ...groupNames].map((g) => {
            const active = lineFilter === g;
            return (
              <Pressable
                key={g ?? "__all"}
                onPress={() => setLineFilter(g)}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: colors.card },
                  active && { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
                testID={`chip-group-${g ?? "all"}`}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? "#fff" : colors.foreground },
                  ]}
                >
                  {g ?? "All"}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {isLoading && itemCount === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `product-${item.id}`}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
              <Text style={[styles.sectionHeaderText, { color: colors.mutedForeground }]}>
                {section.title.toUpperCase()}
              </Text>
              <Text style={[styles.sectionHeaderCount, { color: colors.mutedForeground }]}>
                {section.data.length}
              </Text>
            </View>
          )}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <EmptyState
              icon="package"
              title={search ? "No matches found" : "No products yet"}
              subtitle={
                search
                  ? "Try a different name, SKU, or barcode."
                  : "Products added on the web app will show up here."
              }
            />
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, { borderBottomColor: colors.border }]}
              onPress={() => router.push(`/product/${item.id}` as never)}
              testID={`row-product-${item.id}`}
            >
              <View style={styles.rowText}>
                <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {[item.sku, item.productLineName].filter(Boolean).join(" · ") || "—"}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={[styles.rowPrice, { color: colors.foreground }]}>
                  ${Number(item.price ?? 0).toFixed(2)}
                </Text>
                <Text style={[styles.rowUnit, { color: colors.mutedForeground }]}>
                  per {item.unit || "ea"}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 4,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  chipRow: { paddingHorizontal: 16, gap: 8, flexDirection: "row", alignItems: "center" },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionHeaderText: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  sectionHeaderCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  rowRight: { alignItems: "flex-end" },
  rowPrice: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowUnit: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
