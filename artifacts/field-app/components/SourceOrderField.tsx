import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AdjustmentSourceOrder,
  getListAdjustmentSourceOrdersQueryKey,
  useListAdjustmentSourceOrders,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

function fmtShortDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface Props {
  customerId: number;
  productId: number;
  selectedWorkOrderId: number | null;
  onSelect: (order: AdjustmentSourceOrder | null) => void;
  onResolvedQuantity?: (qty: number | null) => void;
}

// Per-line picker linking a returned/credited product to the source work order
// it was originally sold on. Loads matching WO lines for the product and
// pre-selects the most recent one (auto-filling qty + unit price). Optional —
// the rep can clear it back to none.
export function SourceOrderField({
  customerId,
  productId,
  selectedWorkOrderId,
  onSelect,
  onResolvedQuantity,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const params = { productId };
  const { data, isLoading } = useListAdjustmentSourceOrders(customerId, params, {
    query: {
      queryKey: getListAdjustmentSourceOrdersQueryKey(customerId, params),
      enabled: !!customerId && !!productId,
    },
  });
  const orders = useMemo(() => data ?? [], [data]);

  // Filter by WO number or date as the rep types.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((o) => {
      const haystack =
        `${o.orderNumber} ${fmtShortDate(o.createdAt)}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [orders, search]);

  // Auto-pre-select the most recent matching WO once per product, when nothing
  // is linked yet. The ref guards against re-applying after a manual clear.
  const autoAppliedFor = useRef<number | null>(null);
  useEffect(() => {
    if (autoAppliedFor.current === productId) return;
    if (selectedWorkOrderId != null) {
      autoAppliedFor.current = productId;
      return;
    }
    if (orders.length > 0) {
      autoAppliedFor.current = productId;
      onSelect(orders[0]);
    }
  }, [productId, orders, selectedWorkOrderId, onSelect]);

  const selected = orders.find((o) => o.workOrderId === selectedWorkOrderId);

  // Report the matched line's quantity up so the parent can flag over-returns,
  // for both freshly picked and previously linked orders.
  useEffect(() => {
    onResolvedQuantity?.(selected?.quantity ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.quantity]);

  const label = selected
    ? `${selected.orderNumber}${
        selected.createdAt ? ` · ${fmtShortDate(selected.createdAt)}` : ""
      }`
    : selectedWorkOrderId != null
      ? `WO #${selectedWorkOrderId}`
      : "Link source order (optional)";

  return (
    <>
      <Pressable
        style={[
          styles.field,
          { backgroundColor: colors.background, borderColor: colors.border },
        ]}
        onPress={() => setOpen(true)}
      >
        <Feather name="link" size={14} color={colors.mutedForeground} />
        <Text
          style={[
            styles.fieldText,
            {
              color: selected
                ? colors.foreground
                : colors.mutedForeground,
            },
          ]}
          numberOfLines={1}
        >
          {isLoading ? "Loading orders…" : label}
        </Text>
        {selectedWorkOrderId != null ? (
          <Pressable onPress={() => onSelect(null)} hitSlop={8}>
            <Feather name="x" size={15} color={colors.mutedForeground} />
          </Pressable>
        ) : (
          <Feather
            name="chevron-right"
            size={16}
            color={colors.mutedForeground}
          />
        )}
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View
          style={[
            styles.root,
            { backgroundColor: colors.background, paddingTop: insets.top + 8 },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Source work order
            </Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={8}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <View
              style={[
                styles.searchBar,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Feather name="search" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.searchInput, { color: colors.foreground }]}
                placeholder="Search by WO number or date…"
                placeholderTextColor={colors.mutedForeground}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {search ? (
                <Pressable onPress={() => setSearch("")} hitSlop={8}>
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
          </View>

          {isLoading && orders.length === 0 ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => `source-wo-${item.workOrderId}`}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
              ListHeaderComponent={
                <Pressable
                  style={[styles.row, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    onSelect(null);
                    setOpen(false);
                  }}
                >
                  <Text
                    style={[styles.rowName, { color: colors.foreground }]}
                  >
                    No source order
                  </Text>
                  {selectedWorkOrderId == null ? (
                    <Feather name="check" size={18} color={colors.primary} />
                  ) : null}
                </Pressable>
              }
              ListEmptyComponent={
                <View style={styles.center}>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: "Inter_400Regular",
                    }}
                  >
                    No matching work orders for this product.
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.row, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    onSelect(item);
                    setOpen(false);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.rowName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {item.orderNumber}
                    </Text>
                    <Text
                      style={[
                        styles.rowSub,
                        { color: colors.mutedForeground },
                      ]}
                      numberOfLines={1}
                    >
                      {fmtShortDate(item.createdAt)}
                      {item.quantity != null ? `  ·  qty ${item.quantity}` : ""}
                      {item.unitPriceCents != null
                        ? `  ·  $${(item.unitPriceCents / 100).toFixed(2)}`
                        : ""}
                    </Text>
                  </View>
                  {item.workOrderId === selectedWorkOrderId ? (
                    <Feather name="check" size={18} color={colors.primary} />
                  ) : (
                    <Feather
                      name="chevron-right"
                      size={18}
                      color={colors.mutedForeground}
                      style={{ marginLeft: 8 }}
                    />
                  )}
                </Pressable>
              )}
            />
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
  },
  fieldText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
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
  center: { paddingVertical: 48, alignItems: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  rowName: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  rowSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
});
