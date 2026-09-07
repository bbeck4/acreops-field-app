import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import {
  useGetCustomer,
  useListCustomerContacts,
  useListCustomerEquipment,
  useGetCustomerServiceHistory,
  useGetQbCustomerBalances,
  getGetCustomerQueryKey,
  getListCustomerContactsQueryKey,
  getListCustomerEquipmentQueryKey,
  getGetCustomerServiceHistoryQueryKey,
  getGetQbCustomerBalancesQueryKey,
  type Contact,
  type CustomerEquipment,
  type ServiceJobHistoryEntry,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

// Collapsible read-only panel summarising the customer behind a service job:
// key contacts, on-site equipment, the most recent service visit, and the
// QuickBooks open balance. Everything is cached to AsyncStorage on each
// successful fetch and hydrated on mount so a tech in a dead zone still sees
// the last-known snapshot.

interface CachedContext {
  customerName: string | null;
  phone: string | null;
  address: string | null;
  contacts: Contact[];
  equipment: CustomerEquipment[];
  lastJob: ServiceJobHistoryEntry | null;
  openBalance: number | null;
  overdueBalance: number | null;
}

const CTX_KEY = (customerId: number) => `@agriops:cust_ctx:${customerId}`;

const fmtMoney = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
};

export function CustomerContextPanel({ customerId }: { customerId: number }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const [cached, setCached] = useState<CachedContext | null>(null);

  const enabled = !!customerId;

  const { data: customer } = useGetCustomer(customerId, {
    query: { enabled, queryKey: getGetCustomerQueryKey(customerId) },
  });
  const { data: contacts } = useListCustomerContacts(customerId, {
    query: { enabled, queryKey: getListCustomerContactsQueryKey(customerId) },
  });
  const { data: equipment } = useListCustomerEquipment(customerId, {
    query: { enabled, queryKey: getListCustomerEquipmentQueryKey(customerId) },
  });
  const { data: history } = useGetCustomerServiceHistory(customerId, {
    query: { enabled, queryKey: getGetCustomerServiceHistoryQueryKey(customerId) },
  });
  const { data: balances } = useGetQbCustomerBalances({
    query: { enabled, queryKey: getGetQbCustomerBalancesQueryKey() },
  });

  // Hydrate from cache once on mount so the panel has content offline.
  useEffect(() => {
    if (!customerId) return;
    AsyncStorage.getItem(CTX_KEY(customerId))
      .then((raw) => {
        if (raw) {
          try {
            setCached(JSON.parse(raw) as CachedContext);
          } catch {
            // ignore corrupt cache
          }
        }
      })
      .catch(() => {});
  }, [customerId]);

  const balance = useMemo(
    () => (balances ?? []).find((b) => b.customerId === customerId) ?? null,
    [balances, customerId],
  );

  // Most-recent service job (history.jobs is the customer's service log).
  const lastJob = useMemo<ServiceJobHistoryEntry | null>(() => {
    const jobs = history?.jobs ?? [];
    if (jobs.length === 0) return null;
    return [...jobs].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    )[0];
  }, [history]);

  // Whenever any live data lands, fold it into the resolved view and persist.
  const resolved: CachedContext | null = useMemo(() => {
    const haveLive = !!(customer || contacts || equipment || history || balances);
    if (!haveLive) return cached;
    return {
      customerName: customer?.name ?? cached?.customerName ?? null,
      phone: customer?.phone ?? cached?.phone ?? null,
      address: customer?.address ?? cached?.address ?? null,
      contacts: contacts ?? cached?.contacts ?? [],
      equipment: equipment ?? cached?.equipment ?? [],
      lastJob: lastJob ?? cached?.lastJob ?? null,
      openBalance: balance ? balance.openBalance : cached?.openBalance ?? null,
      overdueBalance: balance ? balance.overdueBalance : cached?.overdueBalance ?? null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer, contacts, equipment, history, balances, balance, lastJob]);

  useEffect(() => {
    if (!customerId || !resolved) return;
    // Only persist when we actually have fresh data (not just the cached
    // snapshot we already loaded).
    if (customer || contacts || equipment || history || balances) {
      AsyncStorage.setItem(CTX_KEY(customerId), JSON.stringify(resolved)).catch(() => {});
    }
  }, [customerId, resolved, customer, contacts, equipment, history, balances]);

  const view = resolved ?? cached;

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 14,
    },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
    headerTitle: { fontSize: 14, fontWeight: "700", color: colors.cardForeground },
    headerSub: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    body: { paddingHorizontal: 14, paddingBottom: 14, gap: 14 },
    block: { gap: 6 },
    blockTitle: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    line: { fontSize: 13, color: colors.cardForeground },
    meta: { fontSize: 12, color: colors.mutedForeground },
    contactRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 4,
    },
    callBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.muted,
    },
    callBtnText: { fontSize: 12, fontWeight: "600", color: colors.foreground },
    balanceRow: { flexDirection: "row", gap: 10 },
    balancePill: {
      flex: 1,
      borderRadius: 10,
      padding: 10,
      backgroundColor: colors.muted,
    },
    balanceValue: { fontSize: 16, fontWeight: "700", color: colors.foreground },
    balanceLabel: { fontSize: 11, color: colors.mutedForeground, marginTop: 2 },
  });

  if (!customerId) return null;

  const contactList = view?.contacts ?? [];
  const equipmentList = view?.equipment ?? [];

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.headerRow}
        onPress={() => setExpanded((e) => !e)}
        testID="customer-context-toggle"
      >
        <View style={styles.headerLeft}>
          <Feather name="user" size={18} color={colors.mutedForeground} />
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {view?.customerName ?? "Customer context"}
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {view?.overdueBalance != null && view.overdueBalance > 0
                ? `${fmtMoney(view.overdueBalance)} overdue`
                : view?.openBalance != null && view.openBalance > 0
                  ? `${fmtMoney(view.openBalance)} open balance`
                  : "Tap for contacts, equipment & balance"}
            </Text>
          </View>
        </View>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={20}
          color={colors.mutedForeground}
        />
      </Pressable>

      {expanded && (
        <View style={styles.body}>
          {/* Open balance */}
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Account balance</Text>
            {view?.openBalance == null && view?.overdueBalance == null ? (
              <Text style={styles.meta}>No balance data.</Text>
            ) : (
              <View style={styles.balanceRow}>
                <View style={styles.balancePill}>
                  <Text style={styles.balanceValue}>
                    {fmtMoney(view?.openBalance ?? 0)}
                  </Text>
                  <Text style={styles.balanceLabel}>Open balance</Text>
                </View>
                <View
                  style={[
                    styles.balancePill,
                    (view?.overdueBalance ?? 0) > 0 && { backgroundColor: colors.destructive + "20" },
                  ]}
                >
                  <Text
                    style={[
                      styles.balanceValue,
                      (view?.overdueBalance ?? 0) > 0 && { color: colors.destructive },
                    ]}
                  >
                    {fmtMoney(view?.overdueBalance ?? 0)}
                  </Text>
                  <Text style={styles.balanceLabel}>Overdue</Text>
                </View>
              </View>
            )}
          </View>

          {/* Contacts */}
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Contacts</Text>
            {contactList.length === 0 ? (
              <Text style={styles.meta}>No contacts on file.</Text>
            ) : (
              contactList.slice(0, 4).map((c) => (
                <View key={c.id} style={styles.contactRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.line} numberOfLines={1}>
                      {c.name}
                      {c.title ? ` · ${c.title}` : ""}
                    </Text>
                    {c.phone ? <Text style={styles.meta}>{c.phone}</Text> : null}
                  </View>
                  {c.phone ? (
                    <Pressable
                      style={styles.callBtn}
                      onPress={() => Linking.openURL(`tel:${c.phone}`)}
                    >
                      <Feather name="phone" size={13} color={colors.foreground} />
                      <Text style={styles.callBtnText}>Call</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))
            )}
          </View>

          {/* Equipment */}
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Equipment</Text>
            {equipmentList.length === 0 ? (
              <Text style={styles.meta}>No equipment recorded.</Text>
            ) : (
              equipmentList.slice(0, 4).map((e) => (
                <View key={e.id}>
                  <Text style={styles.line} numberOfLines={1}>
                    {[e.manufacturer, e.model].filter(Boolean).join(" ") || e.kind}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {e.kind}
                    {e.serial ? ` · SN ${e.serial}` : ""}
                    {e.lastServiceAt ? ` · last ${fmtDate(e.lastServiceAt)}` : ""}
                  </Text>
                </View>
              ))
            )}
          </View>

          {/* Last service */}
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Last service</Text>
            {view?.lastJob ? (
              <View>
                <Text style={styles.line} numberOfLines={2}>
                  {view.lastJob.summary ?? view.lastJob.kind.replace(/_/g, " ")}
                </Text>
                <Text style={styles.meta}>
                  {fmtDate(view.lastJob.occurredAt)}
                  {view.lastJob.techName ? ` · ${view.lastJob.techName}` : ""}
                  {view.lastJob.timeOnSiteMinutes != null
                    ? ` · ${view.lastJob.timeOnSiteMinutes} min`
                    : ""}
                </Text>
              </View>
            ) : (
              <Text style={styles.meta}>No prior service visits.</Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
