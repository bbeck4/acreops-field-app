import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListProductLinesQueryKey,
  getListProductsQueryKey,
  useListProductLines,
  useListProducts,
} from "@workspace/api-client-react";

import { LowMarginBadge, type MarginFloorInfo } from "@/components/MarginFloorWarning";
import {
  calculatorEligibleProducts,
  filterByGroup,
  pickerGroupNames,
} from "@/lib/calculatorProducts";
import { useColors } from "@/hooks/useColors";

export type PickedProduct = {
  id: number;
  name: string;
  sku?: string | null;
  price?: number;
  unit?: string | null;
  cost?: number | null;
} & MarginFloorInfo;

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (product: PickedProduct) => void;
  title?: string;
  /**
   * When set, only show products whose product group is tagged for that blend
   * calculator on the web app (showInLiquidCalculator / showInDryCalculator).
   * Falls back to the legacy name heuristic when no group is tagged yet.
   */
  calculatorMode?: "liquid" | "dry";
}

export function ProductPicker({ visible, onClose, onSelect, title = "Select a product", calculatorMode }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string | null>(null);

  // Reset the category chip when the picker closes so a later reopen starts
  // from the full list (search already resets per open via autoFocus typing).
  const handleClose = () => {
    setGroup(null);
    onClose();
  };

  const { data: products, isLoading } = useListProducts(
    { search: search || undefined },
    { query: { queryKey: getListProductsQueryKey({ search: search || undefined }), enabled: visible } },
  );

  const linesQuery = useListProductLines({
    query: { queryKey: getListProductLinesQueryKey(), enabled: visible && calculatorMode != null },
  });
  const productLines = linesQuery.data;
  // While the tag list is still actively loading we must not filter by the
  // legacy name heuristic (a rep could pick a wrong-calculator product in that
  // window). Offline/failed lookups DO fall back so offline blending still works.
  const linesPending =
    calculatorMode != null &&
    !linesQuery.isSuccess &&
    !linesQuery.isError &&
    linesQuery.fetchStatus === "fetching";

  // Calculator-eligible candidate set (before search/category chips), so chip
  // options never offer a category that can only produce an empty list.
  const eligible = useMemo(
    () => calculatorEligibleProducts(products, productLines, calculatorMode, linesPending),
    [products, productLines, calculatorMode, linesPending],
  );

  const groupNames = useMemo(() => pickerGroupNames(eligible), [eligible]);

  // If results change and the picked category vanished, drop back to All.
  useEffect(() => {
    if (group != null && groupNames.length > 0 && !groupNames.includes(group)) setGroup(null);
  }, [group, groupNames]);

  const items = useMemo<PickedProduct[]>(() => {
    return filterByGroup(eligible, group)
      .map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        price: p.price,
        unit: p.unit,
        cost: p.cost,
        belowMarginFloor: p.belowMarginFloor,
        marginPct: p.marginPct,
        marginFloorPct: p.marginFloorPct,
        marginFloorSource: p.marginFloorSource,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [eligible, group]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Pressable onPress={handleClose} hitSlop={8}>
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <View style={styles.searchWrap}>
          <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search products…"
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="none"
              autoFocus
            />
            {search ? (
              <Pressable onPress={() => setSearch("")}>
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {groupNames.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, height: 44 }}
            contentContainerStyle={styles.chipRow}
          >
            {[null, ...groupNames].map((g) => {
              const active = group === g;
              return (
                <Pressable
                  key={g ?? "__all"}
                  onPress={() => setGroup(g)}
                  style={[
                    styles.chip,
                    { borderColor: colors.border, backgroundColor: colors.card },
                    active && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                  testID={`picker-chip-group-${g ?? "all"}`}
                >
                  <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>
                    {g ?? "All"}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {(isLoading || linesPending) && items.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => `product-${item.id}`}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                  {search || group ? "No matches found" : "No products in catalog"}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                style={[styles.row, { borderBottomColor: colors.border }]}
                onPress={() => onSelect(item)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.sku ? (
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {item.sku}
                    </Text>
                  ) : null}
                  {item.belowMarginFloor ? <LowMarginBadge style={{ marginTop: 4 }} /> : null}
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} style={{ marginLeft: 8 }} />
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 12 },
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
  chipRow: { paddingHorizontal: 16, gap: 8, flexDirection: "row", alignItems: "center" },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  center: { paddingVertical: 48, alignItems: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  rowName: { fontSize: 15, fontFamily: "Inter_500Medium" },
  rowSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
});
