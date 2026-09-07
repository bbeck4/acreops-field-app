import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  computeServicePackageQuote,
  saveServicePackageOrder,
  useGetServicePackageCatalog,
  useListCustomers,
  useListProspects,
  type ServicePackageQuote,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { QtyStepper } from "@/components/QtyStepper";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import { printOrShareHtml, renderServicePackageQuoteHtml } from "@/lib/printDocs";
import { computeLocalServicePackageQuote } from "@/lib/servicePackageQuote";

type TargetKind = "customer" | "prospect";

function centsToUsd(cents: number, unit: string): string {
  const dollars = cents / 100;
  const s = dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2);
  return `$${s}/${unit}`;
}

export default function ServicePackagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isOnline, queueWrite } = useOffline();

  const [step, setStep] = useState(1);
  const [targetKind, setTargetKind] = useState<TargetKind>("customer");
  const [search, setSearch] = useState("");
  const [targetId, setTargetId] = useState<number | null>(null);
  const [targetName, setTargetName] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isProspect = targetKind === "prospect";

  const { data: catalog } = useGetServicePackageCatalog();
  const { data: customers, isLoading: customersLoading } = useListCustomers({
    search: search || undefined,
  });
  const { data: prospects, isLoading: prospectsLoading } = useListProspects();

  const quotableProspects = useMemo(
    () =>
      (prospects ?? []).filter(
        (p) =>
          p.intakeState === "approved" &&
          p.status !== "converted" &&
          p.status !== "lost" &&
          (!search || p.businessName.toLowerCase().includes(search.toLowerCase())),
      ),
    [prospects, search],
  );

  const selectedLines = useMemo(
    () =>
      Object.entries(quantities)
        .map(([packageKey, quantity]) => ({ packageKey, quantity }))
        .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0),
    [quantities],
  );

  const [quote, setQuote] = useState<ServicePackageQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  // Live pricing on the review step (online only). Offline we queue the raw
  // selection and the server prices it authoritatively on replay.
  useEffect(() => {
    if (step !== 3 || !isOnline || selectedLines.length === 0 || targetId == null) {
      if (selectedLines.length === 0) setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const handle = setTimeout(() => {
      computeServicePackageQuote({
        customerId: isProspect ? null : targetId,
        prospectId: isProspect ? targetId : null,
        lines: selectedLines,
      })
        .then((q) => {
          if (!cancelled) setQuote(q);
        })
        .catch(() => {
          if (!cancelled) setQuote(null);
        })
        .finally(() => {
          if (!cancelled) setQuoting(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [step, isOnline, selectedLines, isProspect, targetId]);

  // Offline fallback quote computed from the cached catalog. Lets reps review,
  // print, and share even without a connection (server re-prices on sync).
  const localQuote = useMemo(() => {
    if (!catalog || selectedLines.length === 0) return null;
    return computeLocalServicePackageQuote(catalog, selectedLines);
  }, [catalog, selectedLines]);

  // The quote to display and print: the server quote when online, else the
  // local estimate. Normalized to the print doc's line shape.
  const printData = useMemo(() => {
    if (isOnline && quote) {
      return {
        planName: quote.plan?.name ?? null,
        lines: quote.packages.map((p) => ({
          name: p.name,
          quantity: p.quantity,
          unit: p.unit,
          baseAmount: p.baseAmount,
          discountAmount: p.discountAmount,
          amount: p.amount,
          note: p.note,
        })),
        subtotal: quote.subtotal,
        discountTotal: quote.discountTotal,
        total: quote.total,
        requiresSupportWarning: quote.requiresSupportWarning,
      };
    }
    return localQuote;
  }, [isOnline, quote, localQuote]);

  const setQty = (key: string, qty: number) =>
    setQuantities((cur) => {
      const next = { ...cur };
      if (qty <= 0) delete next[key];
      else next[key] = qty;
      return next;
    });

  const savePayload = (asWorkOrder: boolean) => ({
    customerId: isProspect ? null : targetId,
    prospectId: isProspect ? targetId : null,
    lines: selectedLines,
    asWorkOrder: isProspect ? false : asWorkOrder,
    ...(notes.trim() ? { notes: notes.trim() } : {}),
  });

  const handleSave = async (asWorkOrder: boolean) => {
    if (targetId == null || selectedLines.length === 0) return;
    setIsSubmitting(true);
    const payload = savePayload(asWorkOrder);
    try {
      if (isOnline) {
        const res = await saveServicePackageOrder(payload);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace(`/order/${res.workOrder.id}`);
      } else {
        await queueWrite("servicePackageOrder", payload);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back();
      }
    } catch {
      await queueWrite("servicePackageOrder", payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      router.back();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrint = async () => {
    if (!printData) return;
    await printOrShareHtml(
      renderServicePackageQuoteHtml({
        targetName,
        targetKind,
        planName: printData.planName,
        lines: printData.lines,
        subtotal: printData.subtotal,
        discountTotal: printData.discountTotal,
        total: printData.total,
        requiresSupportWarning: printData.requiresSupportWarning,
      }),
      `service-quote-${targetName}`,
    );
  };

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  const listRows: Array<{ id: number; name: string }> = isProspect
    ? quotableProspects.map((p) => ({ id: p.id, name: p.businessName }))
    : (customers ?? []).map((c) => ({ id: c.id, name: c.name }));
  const listLoading = isProspect ? prospectsLoading : customersLoading;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.topBar,
          {
            paddingTop: topPadding + 8,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable onPress={() => (step > 1 ? setStep(step - 1) : router.back())} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.foreground }]}>Service Packages</Text>
        <View style={styles.steps}>
          {[1, 2, 3].map((s) => (
            <View
              key={s}
              style={[styles.stepDot, { backgroundColor: step >= s ? colors.primary : colors.muted }]}
            />
          ))}
        </View>
      </View>

      {/* Step 1 — Target */}
      {step === 1 ? (
        <View style={styles.stepWrap}>
          <View style={[styles.toggleRow, { borderColor: colors.border }]}>
            {(["customer", "prospect"] as const).map((t) => (
              <Pressable
                key={t}
                style={[
                  styles.toggleBtn,
                  {
                    backgroundColor: targetKind === t ? colors.primary : colors.card,
                    borderColor: targetKind === t ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => {
                  setTargetKind(t);
                  setTargetId(null);
                  setTargetName("");
                }}
              >
                <Text style={[styles.toggleText, { color: targetKind === t ? "#fff" : colors.mutedForeground }]}>
                  {t === "customer" ? "Customer" : "Prospect"}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder={`Search ${isProspect ? "prospects" : "customers"}…`}
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
          <FlatList
            data={listRows}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
            renderItem={({ item }) => (
              <Pressable
                style={[
                  styles.listRow,
                  {
                    backgroundColor: targetId === item.id ? colors.accent : colors.card,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => {
                  setTargetId(item.id);
                  setTargetName(item.name);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setStep(2);
                }}
              >
                <Text style={[styles.listRowText, { color: colors.foreground }]}>{item.name}</Text>
              </Pressable>
            )}
            ListEmptyComponent={
              listLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
              ) : (
                <EmptyState icon="users" title={`No ${isProspect ? "prospects" : "customers"} found`} />
              )
            }
            showsVerticalScrollIndicator={false}
          />
        </View>
      ) : null}

      {/* Step 2 — Packages */}
      {step === 2 ? (
        <ScrollView
          contentContainerStyle={[styles.stepWrap, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.stepTitle, { color: colors.foreground }]}>Select Packages</Text>
          <Text style={[styles.stepSubtitle, { color: colors.mutedForeground }]}>{targetName}</Text>
          {(catalog?.packages ?? []).map((pkg) => (
            <View
              key={pkg.key}
              style={[styles.pkgRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.pkgInfo}>
                <Text style={[styles.pkgName, { color: colors.foreground }]}>{pkg.name}</Text>
                <Text style={[styles.pkgRate, { color: colors.mutedForeground }]}>
                  {pkg.model === "tiered"
                    ? `${centsToUsd(pkg.tierFirstRateCents ?? 0, pkg.unit)} (1–${pkg.tierFirstUnits ?? 0}), then ${centsToUsd(pkg.tierOverflowRateCents ?? 0, pkg.unit)}`
                    : pkg.model === "mileage"
                      ? centsToUsd(catalog?.mileageRateCents ?? 0, pkg.unit)
                      : `${centsToUsd(pkg.rateCents ?? 0, pkg.unit)}${pkg.minCents ? ` · $${(pkg.minCents / 100).toFixed(0)} min` : ""}`}
                </Text>
                {pkg.requiresSupport ? (
                  <Text style={[styles.pkgWarn, { color: "#b45309" }]}>Requires Support Plan</Text>
                ) : null}
              </View>
              <QtyStepper value={quantities[pkg.key] ?? 0} onChange={(q) => setQty(pkg.key, q)} />
            </View>
          ))}
          {selectedLines.length > 0 ? (
            <Pressable
              style={[styles.submitBtn, { backgroundColor: colors.primary, marginTop: 16 }]}
              onPress={() => setStep(3)}
            >
              <Feather name="arrow-right" size={18} color="#fff" />
              <Text style={styles.submitBtnText}>Review Quote</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}

      {/* Step 3 — Review */}
      {step === 3 ? (
        <ScrollView
          contentContainerStyle={[styles.stepWrap, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.stepTitle, { color: colors.foreground }]}>Review Quote</Text>
          <Text style={[styles.stepSubtitle, { color: colors.mutedForeground }]}>{targetName}</Text>

          {isOnline && quoting ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : printData ? (
            <View style={[styles.reviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {!isOnline ? (
                <Text style={[styles.reviewValue, { color: colors.mutedForeground }]}>
                  Offline estimate — final pricing (including any plan discounts) is applied automatically when this saves online.
                </Text>
              ) : null}
              {printData.planName &&
              quote &&
              (quote.plan?.discountLaborPct ||
                quote.plan?.discountMileagePct ||
                quote.plan?.waiveTripFees) ? (
                <Text style={[styles.planLine, { color: colors.primary }]}>
                  {printData.planName} plan discount applied
                </Text>
              ) : null}
              {printData.lines.map((p, i) => (
                <View key={`${p.name}-${i}`} style={styles.lineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.lineName, { color: colors.foreground }]}>{p.name}</Text>
                    <Text style={[styles.lineMeta, { color: colors.mutedForeground }]}>
                      {p.quantity} {p.unit}
                      {p.discountAmount > 0 ? ` · -$${p.discountAmount.toFixed(2)}` : ""}
                      {p.note ? ` · ${p.note}` : ""}
                    </Text>
                  </View>
                  <Text style={[styles.linePrice, { color: colors.foreground }]}>${p.amount.toFixed(2)}</Text>
                </View>
              ))}
              <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Total</Text>
                <Text style={[styles.totalValue, { color: colors.foreground }]}>${printData.total.toFixed(2)}</Text>
              </View>
              {printData.requiresSupportWarning ? (
                <Text style={[styles.pkgWarn, { color: "#b45309", marginTop: 8 }]}>
                  ⚠ Equipment optimization requires an active Support Plan. Add one or confirm the customer has it.
                </Text>
              ) : null}
            </View>
          ) : null}

          <TextInput
            style={[
              styles.notesInput,
              { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
            ]}
            placeholder="Quote notes (optional)"
            placeholderTextColor={colors.mutedForeground}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
          />

          {printData ? (
            <Pressable
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
              onPress={handlePrint}
            >
              <Feather name="printer" size={16} color={colors.foreground} />
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Print / Share</Text>
            </Pressable>
          ) : null}

          <Pressable
            style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: isSubmitting ? 0.6 : 1 }]}
            onPress={() => handleSave(false)}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="file-text" size={18} color="#fff" />
                <Text style={styles.submitBtnText}>Save Estimate</Text>
              </>
            )}
          </Pressable>
          {!isProspect ? (
            <Pressable
              style={[styles.secondaryBtn, { borderColor: colors.primary, opacity: isSubmitting ? 0.6 : 1 }]}
              onPress={() => handleSave(true)}
              disabled={isSubmitting}
            >
              <Feather name="check" size={16} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Save as Work Order</Text>
            </Pressable>
          ) : (
            <Text style={[styles.quoteHint, { color: colors.mutedForeground }]}>
              Prospect quotes save as a draft estimate and carry over when the prospect converts.
            </Text>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: { padding: 4 },
  topTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold" },
  steps: { flexDirection: "row", gap: 6 },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  stepWrap: { flex: 1, padding: 16, gap: 12 },
  stepTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  stepSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: -6 },
  toggleRow: { flexDirection: "row", gap: 8 },
  toggleBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  toggleText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
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
  listRow: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  listRowText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  pkgRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    gap: 12,
  },
  pkgInfo: { flex: 1 },
  pkgName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  pkgRate: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  pkgWarn: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  reviewCard: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 8 },
  reviewValue: { fontSize: 14, fontFamily: "Inter_400Regular" },
  planLine: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  lineName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  lineMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  linePrice: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 4,
  },
  totalLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  totalValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  notesInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 72,
    textAlignVertical: "top",
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 15,
  },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 13,
  },
  secondaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  quoteHint: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
});
