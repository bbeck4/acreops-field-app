import { Feather } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import React from "react";
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
  getListSamplingPlansQueryKey,
  useListSamplingPlans,
  type SamplingPlan,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from "@/components/MapShim";
import { MapTypeToggle, type MapType } from "@/components/MapTypeToggle";
import { useColors } from "@/hooks/useColors";

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type LocatedPlan = SamplingPlan & { centerLat: number; centerLng: number };

function hasCenter(p: SamplingPlan): p is LocatedPlan {
  return typeof p.centerLat === "number" && typeof p.centerLng === "number";
}

/** A region that comfortably frames every located field, with sane min zoom. */
function regionForPlans(plans: LocatedPlan[]): Region | undefined {
  if (plans.length === 0) return undefined;
  const lats = plans.map((p) => p.centerLat);
  const lngs = plans.map((p) => p.centerLng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.05),
    longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.05),
  };
}

export default function SamplingPlansScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const {
    data: plans,
    isLoading,
    isRefetching,
    refetch,
  } = useListSamplingPlans(undefined, {
    query: { queryKey: getListSamplingPlansQueryKey() },
  });

  const [mapType, setMapType] = React.useState<MapType>("hybrid");

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  // Open plans first (planned / in_progress), then the rest, each block newest first,
  // so the field a rep is most likely heading to is at the top.
  const ordered = React.useMemo(() => {
    const list = plans ?? [];
    const rank = (s: string) => (s === "in_progress" ? 0 : s === "planned" ? 1 : 2);
    return [...list].sort((a, b) => {
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [plans]);

  // Plans we can plot — lets a rep see field locations and pick the closest one first.
  const located = React.useMemo(() => ordered.filter(hasCenter), [ordered]);
  const initialRegion = React.useMemo(() => regionForPlans(located), [located]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.topBar,
          {
            paddingTop: topPadding + 8,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="back-button">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          Sampling Plans
        </Text>
        <Pressable
          onPress={() => router.push("/sampling/scan" as never)}
          style={styles.backBtn}
          testID="scan-sample-button"
          accessibilityLabel="Scan sample barcode"
        >
          <Feather name="maximize" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 10 }}>
        <Pressable
          onPress={() => router.push("/sampling/new" as never)}
          style={[styles.quickScanBtn, { backgroundColor: colors.primary }]}
          testID="sample-a-field-button"
          accessibilityLabel="Create a new sampling plan and sample a field"
        >
          <Feather name="map-pin" size={18} color={colors.primaryForeground} />
          <Text style={[styles.quickScanText, { color: colors.primaryForeground }]}>
            Sample a field
          </Text>
        </Pressable>
        <Pressable
          onPress={() => router.push("/sampling/quick-scan" as never)}
          style={[styles.quickScanBtnSecondary, { borderColor: colors.border, backgroundColor: colors.card }]}
          testID="quick-scan-button"
          accessibilityLabel="Scan a soil report without a sampling plan"
        >
          <Feather name="camera" size={18} color={colors.primary} />
          <Text style={[styles.quickScanTextSecondary, { color: colors.foreground }]}>
            Scan soil report (no plan)
          </Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : ordered.length === 0 ? (
        <EmptyState
          icon="map-pin"
          title="No sampling plans"
          subtitle="Plans created on the web for your customers will show up here."
        />
      ) : (
        <FlatList
          data={ordered}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 12 }}
          ListHeaderComponent={
            initialRegion ? (
              <View style={[styles.mapCard, { borderColor: colors.border }]}>
                <MapView
                  style={StyleSheet.absoluteFill}
                  provider={PROVIDER_DEFAULT}
                  mapType={mapType}
                  initialRegion={initialRegion}
                  showsUserLocation
                >
                  {located.map((p) => {
                    const open = p.status === "in_progress" || p.status === "planned";
                    return (
                      <Marker
                        key={p.id}
                        coordinate={{ latitude: p.centerLat, longitude: p.centerLng }}
                        title={p.name}
                        description={p.fieldName ?? p.customerName ?? undefined}
                        onPress={() => router.push(`/sampling/${p.id}` as never)}
                      >
                        <View
                          style={[
                            styles.mapPin,
                            { backgroundColor: open ? colors.primary : "#64748b", borderColor: "#fff" },
                          ]}
                        >
                          <Feather name="map-pin" size={12} color="#fff" />
                        </View>
                      </Marker>
                    );
                  })}
                </MapView>
                <MapTypeToggle value={mapType} onChange={setMapType} style={styles.mapTypeBtn} />
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => <PlanRow plan={item} colors={colors} />}
        />
      )}
    </View>
  );
}

function PlanRow({
  plan,
  colors,
}: {
  plan: SamplingPlan;
  colors: ReturnType<typeof useColors>;
}) {
  const meta = [
    plan.customerName,
    plan.fieldName ?? `Field ${plan.fieldId}`,
    plan.season,
  ]
    .filter(Boolean)
    .join(" · ");

  const sampleCount = plan.sampleCount ?? 0;

  return (
    <Pressable
      onPress={() => router.push(`/sampling/${plan.id}` as never)}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>
          {plan.name}
        </Text>
        {meta ? (
          <Text style={[styles.cardMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        <View style={styles.cardStatsRow}>
          <View style={[styles.statusPill, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Text style={[styles.statusPillText, { color: colors.mutedForeground }]}>
              {titleCase(plan.status)}
            </Text>
          </View>
          <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
            {plan.zoneCount ?? 0} {(plan.zoneCount ?? 0) === 1 ? "zone" : "zones"} ·{" "}
            {sampleCount} {sampleCount === 1 ? "point" : "points"}
          </Text>
        </View>
      </View>
      <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_700Bold" },
  quickScanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
  },
  quickScanText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  quickScanBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  quickScanTextSecondary: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  mapCard: {
    height: 220,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    position: "relative",
  },
  mapTypeBtn: { position: "absolute", top: 12, left: 12 },
  mapPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  cardStatsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusPillText: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
