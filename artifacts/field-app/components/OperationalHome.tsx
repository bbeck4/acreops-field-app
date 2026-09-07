import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListDeliveryLoadsQueryKey,
  useGetFulfillmentDesk,
  useGetWarehouseHome,
  useListDeliveryLoads,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { OfflineBanner } from "@/components/OfflineBanner";
import { StatCard } from "@/components/StatCard";
import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

// Real day-runner home screens for the operational role tracks (warehouse,
// fulfillment, delivery driver). These replace the generic "Coming soon"
// RoleStubScreen: each pulls the member's real assigned work from the same
// backend the web platform uses and deep-links into the existing detail
// screens (pick lists, work orders, loads, stops).
//
// Every screen accepts an optional `topSlot` so the dual-role home switcher can
// be threaded in above the content for members who flip between their full
// dashboard and their operational track.

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Shared shell ──────────────────────────────────────────────────────────
function Shell({
  title,
  subtitle,
  topSlot,
  loading,
  refreshing,
  onRefresh,
  children,
}: {
  title: string;
  subtitle: string;
  topSlot?: ReactNode;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{
          paddingTop: topPadding + 16,
          paddingBottom: insets.bottom + 100,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {topSlot ? <View style={styles.topSlot}>{topSlot}</View> : null}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {subtitle}
          </Text>
        </View>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 48 }} color={colors.primary} />
        ) : (
          children
        )}
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function getStatusColor(status: string, colors: ReturnType<typeof useColors>) {
  switch (status.toLowerCase()) {
    case "open": return { bg: colors.secondary, fg: colors.secondaryForeground };
    case "picking": return { bg: colors.accent, fg: colors.accentForeground };
    case "picked": return { bg: colors.primary, fg: colors.primaryForeground };
    case "short": return { bg: colors.destructive, fg: colors.destructiveForeground };
    case "draft": return { bg: colors.muted, fg: colors.mutedForeground };
    case "confirmed": return { bg: colors.accent, fg: colors.accentForeground };
    case "allocated": return { bg: colors.secondary, fg: colors.secondaryForeground };
    case "loaded": return { bg: colors.warningBackground, fg: colors.warning };
    case "delivered": return { bg: colors.primary, fg: colors.primaryForeground };
    case "planned": return { bg: colors.muted, fg: colors.mutedForeground };
    case "en_route": return { bg: colors.accent, fg: colors.accentForeground };
    case "refused": return { bg: colors.warningBackground, fg: colors.warning };
    case "incident": return { bg: colors.destructive, fg: colors.destructiveForeground };
    case "cancelled": return { bg: colors.muted, fg: colors.mutedForeground };
    case "open_po": return { bg: colors.secondary, fg: colors.secondaryForeground };
    case "partially_received": return { bg: colors.warningBackground, fg: colors.warning };
    default: return { bg: colors.muted, fg: colors.mutedForeground };
  }
}

function StatusPill({ status }: { status: string }) {
  const colors = useColors();
  const sc = getStatusColor(status, colors);
  return (
    <View style={[styles.pill, { backgroundColor: sc.bg }]}>
      <Text style={[styles.pillText, { color: sc.fg }]}>{status}</Text>
    </View>
  );
}

function RowCard({
  title,
  subtitle,
  status,
  rightText,
  danger,
  onPress,
  testID,
}: {
  title: string;
  subtitle?: string;
  status?: string;
  rightText?: string;
  danger?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const colors = useColors();
  const body = (
    <View
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.cardTitle, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[styles.cardSub, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {rightText ? (
        <Text
          style={[
            styles.rightText,
            { color: danger ? colors.destructive : colors.foreground },
          ]}
        >
          {rightText}
        </Text>
      ) : null}
      {status ? <StatusPill status={status} /> : null}
      {onPress ? (
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {body}
    </Pressable>
  );
}

function go(path: string) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  router.push(path as never);
}

// ── Warehouse ───────────────────────────────────────────────────────────────
export function WarehouseHome({ topSlot }: { topSlot?: ReactNode }) {
  const { data, isLoading, refetch, isRefetching } = useGetWarehouseHome();
  const pickQueue = data?.pickQueue ?? [];
  const inbound = data?.inboundReceipts ?? [];
  const lowStock = data?.lowStock ?? [];
  const shorts = data?.shorts ?? [];

  return (
    <Shell
      title="Warehouse"
      subtitle={`${pickQueue.length} to pick · ${inbound.length} inbound`}
      topSlot={topSlot}
      loading={isLoading && !data}
      refreshing={isRefetching}
      onRefresh={refetch}
    >
      <View style={styles.statsRow}>
        <StatCard label="Pick queue" value={pickQueue.length} icon="clipboard" accent />
        <StatCard label="Inbound" value={inbound.length} icon="download" />
        <StatCard label="Low stock" value={lowStock.length} icon="alert-triangle" />
      </View>

      <Section title="Pick queue">
        {pickQueue.length === 0 ? (
          <EmptyState
            icon="check-circle"
            title="Nothing to pick"
            subtitle="The pick queue is clear."
          />
        ) : (
          pickQueue.map((p) => (
            <RowCard
              key={p.id}
              title={p.summary}
              subtitle={p.customerName ?? undefined}
              status={p.status}
              onPress={() => go(`/pick-list/${p.id}`)}
              testID={`pick-${p.id}`}
            />
          ))
        )}
      </Section>

      {inbound.length > 0 && (
        <Section title="Inbound">
          {inbound.map((p) => (
            <RowCard
              key={p.id}
              title={p.poNumber}
              subtitle={
                [p.vendorName, p.siteName].filter(Boolean).join(" · ") || undefined
              }
              status={p.status}
            />
          ))}
        </Section>
      )}

      {lowStock.length > 0 && (
        <Section title="Low stock">
          {lowStock.slice(0, 8).map((l) => (
            <RowCard
              key={`${l.siteId}-${l.productId}`}
              title={l.productName ?? ""}
              subtitle={`${l.siteName ?? ""} · min ${l.reorderThreshold}`}
              rightText={`${l.quantityOnHand} ${l.unit ?? ""}`.trim()}
              danger
            />
          ))}
        </Section>
      )}

      {shorts.length > 0 && (
        <Section title="Picking shorts">
          {shorts.map((s, i) => (
            <RowCard
              key={`${s.pickListId}-${i}`}
              title={s.productName}
              subtitle={
                [s.customerName, s.orderSummary].filter(Boolean).join(" · ") ||
                undefined
              }
              rightText={`${s.qtyPicked}/${s.qtyRequested}`}
              danger
              onPress={() => go(`/pick-list/${s.pickListId}`)}
              testID={`short-${s.pickListId}-${i}`}
            />
          ))}
        </Section>
      )}
    </Shell>
  );
}

// ── Fulfillment desk ─────────────────────────────────────────────────────────
export function FulfillmentHome({ topSlot }: { topSlot?: ReactNode }) {
  const { data, isLoading, refetch, isRefetching } = useGetFulfillmentDesk();
  const counts = data?.counts;
  const groups = [
    { title: "To allocate", orders: data?.toAllocate ?? [] },
    { title: "Ready to ship", orders: data?.readyToShip ?? [] },
    { title: "Short", orders: data?.short ?? [] },
    { title: "Awaiting confirmation", orders: data?.awaitingConfirmation ?? [] },
    { title: "Exceptions", orders: data?.exceptions ?? [] },
  ];
  const total = groups.reduce((n, g) => n + g.orders.length, 0);

  return (
    <Shell
      title="Fulfillment desk"
      subtitle={`${counts?.toAllocate ?? 0} to allocate · ${counts?.readyToShip ?? 0} ready`}
      topSlot={topSlot}
      loading={isLoading && !data}
      refreshing={isRefetching}
      onRefresh={refetch}
    >
      <View style={styles.statsRow}>
        <StatCard label="To allocate" value={counts?.toAllocate ?? 0} icon="layers" accent />
        <StatCard label="Ready" value={counts?.readyToShip ?? 0} icon="truck" />
        <StatCard label="Exceptions" value={counts?.exceptions ?? 0} icon="alert-triangle" />
      </View>

      {total === 0 ? (
        <Section title="Desk">
          <EmptyState
            icon="check-circle"
            title="Desk is clear"
            subtitle="No orders need attention right now."
          />
        </Section>
      ) : (
        groups.map((g) =>
          g.orders.length ? (
            <Section key={g.title} title={`${g.title} (${g.orders.length})`}>
              {g.orders.map((o) => {
                const bits = [o.customerName, o.sourceSiteName].filter(Boolean);
                if (o.shortLineCount) bits.push(`${o.shortLineCount} short`);
                return (
                  <RowCard
                    key={o.id}
                    title={o.orderNumber}
                    subtitle={bits.join(" · ") || undefined}
                    status={o.status}
                    danger={!!o.shortLineCount}
                    onPress={() => go(`/order/${o.id}`)}
                    testID={`fulfillment-order-${o.id}`}
                  />
                );
              })}
            </Section>
          ) : null,
        )
      )}
    </Shell>
  );
}

// ── Delivery driver ──────────────────────────────────────────────────────────
export function DeliveryHome({ topSlot }: { topSlot?: ReactNode }) {
  const colors = useColors();
  const { currentMember } = useAppAuth();
  const date = todayIso();
  const driverId = currentMember?.id;

  const { data: loads, isLoading, refetch, isRefetching } = useListDeliveryLoads(
    { date, driverId },
    {
      query: {
        queryKey: getListDeliveryLoadsQueryKey({ date, driverId }),
        enabled: !!driverId,
        refetchInterval: 30_000,
      },
    },
  );

  const list = loads ?? [];
  const remaining = list.reduce(
    (n, l) =>
      n +
      l.stops.filter((s) => s.status !== "delivered" && s.status !== "cancelled")
        .length,
    0,
  );

  return (
    <Shell
      title="My loads"
      subtitle={`${list.length} load${list.length === 1 ? "" : "s"} · ${remaining} stop${remaining === 1 ? "" : "s"} to go`}
      topSlot={topSlot}
      loading={isLoading && !loads}
      refreshing={isRefetching}
      onRefresh={refetch}
    >
      {!driverId ? (
        <Section title="Today">
          <EmptyState
            icon="user"
            title="Driver profile not found"
            subtitle="Ask your dispatcher to set up your driver account."
          />
        </Section>
      ) : list.length === 0 ? (
        <Section title="Today">
          <EmptyState
            icon="truck"
            title="No loads assigned"
            subtitle="When dispatch builds a load for you, it'll show up here."
          />
        </Section>
      ) : (
        list.map((load) => {
          const left = load.stops.filter(
            (s) => s.status !== "delivered" && s.status !== "cancelled",
          ).length;
          return (
            <View key={load.id} style={styles.section}>
              <Pressable
                onPress={() => go(`/load/${load.id}`)}
                testID={`load-${load.id}`}
                style={({ pressed }) => [
                  styles.loadHeader,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                    {load.truck ?? "Unassigned truck"}
                  </Text>
                  <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                    {load.stops.length} stop{load.stops.length === 1 ? "" : "s"} · {left} to go
                    {load.plannedWindowEnd
                      ? ` · due ${new Date(load.plannedWindowEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : ""}
                  </Text>
                </View>
                <Feather name="chevron-right" size={22} color={colors.mutedForeground} />
              </Pressable>
              {load.stops.slice(0, 6).map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => go(`/stop/${s.id}`)}
                  testID={`stop-${s.id}`}
                  style={({ pressed }) => [
                    styles.stopRow,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.stopOrder, { color: colors.mutedForeground }]}>
                    {s.stopOrder}
                  </Text>
                  <Text
                    style={[styles.stopName, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {s.customerName ?? "Customer"}
                  </Text>
                  <StatusPill status={s.status} />
                </Pressable>
              ))}
              {load.stops.length > 6 ? (
                <Text style={[styles.moreText, { color: colors.mutedForeground }]}>
                  +{load.stops.length - 6} more
                </Text>
              ) : null}
            </View>
          );
        })
      )}
    </Shell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topSlot: { paddingHorizontal: 16, marginBottom: 8 },
  header: { paddingHorizontal: 16, paddingBottom: 4 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, marginTop: 2, fontFamily: "Inter_400Regular" },
  statsRow: { flexDirection: "row", gap: 12, paddingHorizontal: 16, marginTop: 16 },
  section: { paddingHorizontal: 16, paddingTop: 18 },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardSub: { fontSize: 12, marginTop: 4, fontFamily: "Inter_400Regular" },
  rightText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  pillText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "capitalize",
  },
  loadHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  stopOrder: { fontSize: 12, width: 18, fontFamily: "Inter_500Medium" },
  stopName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  moreText: { fontSize: 12, fontStyle: "italic", marginTop: 2, marginLeft: 4 },
});
