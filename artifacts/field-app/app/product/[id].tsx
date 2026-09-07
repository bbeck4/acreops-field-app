import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetInventoryAvailabilityQueryKey,
  getGetProductQueryKey,
  useGetInventoryAvailability,
  useGetProduct,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { useColors } from "@/hooks/useColors";

export default function ProductDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const productId = Number(params.id);
  const validId = Number.isFinite(productId) && productId > 0;

  const { data: product, isLoading: productLoading, error: productError } =
    useGetProduct(productId, {
      query: { enabled: validId, queryKey: getGetProductQueryKey(productId) },
    });

  const productIds = validId ? String(productId) : "";
  const { data: availability, isLoading: availLoading } = useGetInventoryAvailability(
    { productIds },
    {
      query: {
        enabled: validId,
        queryKey: getGetInventoryAvailabilityQueryKey({ productIds }),
      },
    },
  );
  const av = useMemo(
    () => (availability ?? []).find((a) => a.productId === productId),
    [availability, productId],
  );

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  if (!validId || productError) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: topPadding }]}>
        <Header onBack={() => router.back()} title="Product" colors={colors} />
        <EmptyState
          icon="alert-circle"
          title="Product not found"
          subtitle="That product is no longer available."
        />
      </View>
    );
  }

  if (productLoading || !product) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: topPadding }]}>
        <Header onBack={() => router.back()} title="Product" colors={colors} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  const sites = (av?.sites ?? []).slice().sort((a, b) => b.quantityOnHand - a.quantityOnHand);
  const lowStock =
    av != null && product.reorderThreshold != null && av.totalOnHand <= product.reorderThreshold;

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: topPadding }]}>
      <Header onBack={() => router.back()} title="Product" colors={colors} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={[styles.name, { color: colors.foreground }]}>{product.name}</Text>
          <Text style={[styles.sku, { color: colors.mutedForeground }]}>SKU {product.sku}</Text>
          {product.productLineName ? (
            <Text style={[styles.line, { color: colors.mutedForeground }]}>
              {product.productLineName}
            </Text>
          ) : null}
        </View>

        <View style={styles.statsRow}>
          <Stat
            label="On hand"
            value={
              availLoading ? "…" : av ? `${av.totalOnHand} ${product.unit}` : `0 ${product.unit}`
            }
            colors={colors}
            accent={lowStock ? colors.destructive : undefined}
          />
          <Stat
            label="Available"
            value={
              availLoading ? "…" : av ? `${av.available} ${product.unit}` : `0 ${product.unit}`
            }
            colors={colors}
          />
          <Stat
            label="Price"
            value={`$${product.price.toFixed(2)}`}
            colors={colors}
          />
        </View>

        {product.description ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Description</Text>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
              {product.description}
            </Text>
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>On hand by site</Text>
          {availLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          ) : sites.length === 0 ? (
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
              No stock recorded at any site.
            </Text>
          ) : (
            sites.map((s) => (
              <View
                key={s.siteId}
                style={[styles.siteRow, { borderTopColor: colors.border }]}
              >
                <Text style={[styles.siteName, { color: colors.foreground }]} numberOfLines={1}>
                  {s.siteName}
                </Text>
                <Text style={[styles.siteQty, { color: colors.foreground }]}>
                  {s.quantityOnHand} {product.unit}
                </Text>
              </View>
            ))
          )}
          {av != null ? (
            <View style={[styles.siteRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.siteName, { color: colors.mutedForeground }]}>Committed</Text>
              <Text style={[styles.siteQty, { color: colors.mutedForeground }]}>
                {av.committed} {product.unit}
              </Text>
            </View>
          ) : null}
        </View>

        <Pressable
          style={[styles.scanAgain, { borderColor: colors.primary }]}
          onPress={() => router.replace("/scan" as never)}
        >
          <Feather name="maximize" size={16} color={colors.primary} />
          <Text style={[styles.scanAgainText, { color: colors.primary }]}>Scan another</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Header({
  onBack,
  title,
  colors,
}: {
  onBack: () => void;
  title: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
        <Feather name="chevron-left" size={24} color={colors.foreground} />
      </Pressable>
      <Text style={[styles.headerTitle, { color: colors.foreground }]}>{title}</Text>
      <View style={styles.backBtn} />
    </View>
  );
}

function Stat({
  label,
  value,
  colors,
  accent,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
  accent?: string;
}) {
  return (
    <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.statValue, { color: accent ?? colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 24, fontFamily: "Inter_700Bold" },
  sku: { marginTop: 4, fontSize: 13, fontFamily: "Inter_500Medium" },
  line: { marginTop: 2, fontSize: 13, fontFamily: "Inter_400Regular" },
  statsRow: { flexDirection: "row", gap: 10 },
  stat: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cardBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  siteRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  siteName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", marginRight: 12 },
  siteQty: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  scanAgain: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  scanAgainText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
