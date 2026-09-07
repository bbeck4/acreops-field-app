import { Feather } from "@expo/vector-icons";
import { useQueries } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Linking,
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
  getGetProductNutrientAnalysisQueryOptions,
  getListCustomerFieldsQueryKey,
  useAddWorkOrderItem,
  useCreateBlendSave,
  useCreateDryBlendSave,
  useCreateWorkOrder,
  getGetCustomerQueryKey,
  useEmailBlendReceipt,
  useCreateBlendReceiptLink,
  useGetCustomer,
  useGetWeightedAverageCost,
  useListCustomerFields,
  useListCustomers,
  type BlendReceiptData,
} from "@workspace/api-client-react";

import { ProductPicker, type PickedProduct } from "@/components/ProductPicker";
import { usePrivacy } from "@/context/PrivacyContext";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import {
  buildOrderLines,
  buildRateChartRows,
  computeAnalysis,
  computeCostMargin,
  computeLiquidProfile,
  newComboMixKey,
  toPerGallonPrice,
  type AnalysisMap,
  type BlendComponentRow,
  type BlendMode,
  type CostMap,
} from "@/lib/blend";

interface Props {
  mode: BlendMode;
}

const qtyLabel = (mode: BlendMode) => (mode === "dry" ? "lbs" : "gal");
const rateLabel = (mode: BlendMode) => (mode === "dry" ? "lbs/acre" : "gal/acre");

export function BlendBuilder({ mode }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isOnline } = useOffline();
  const { customerMode } = usePrivacy();

  const [components, setComponents] = useState<BlendComponentRow[]>([]);
  // Raw quantity text per product so in-progress decimals (".5", "1.") aren't
  // destroyed by round-tripping through Number.
  const [qtyTexts, setQtyTexts] = useState<Record<number, string>>({});
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [fieldId, setFieldId] = useState<number | null>(null);
  const [fieldName, setFieldName] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [acres, setAcres] = useState("");
  const [ratePerAcre, setRatePerAcre] = useState("");
  const [isQuote, setIsQuote] = useState(true);

  const [showProducts, setShowProducts] = useState(false);
  const [showCustomers, setShowCustomers] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);

  // Customer-facing blend receipt (email / text) — liquid mode, mirrors web.
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptChannel, setReceiptChannel] = useState<"email" | "sms">("email");
  const [receiptEmail, setReceiptEmail] = useState("");
  const [receiptPhone, setReceiptPhone] = useState("");
  const [sendingReceipt, setSendingReceipt] = useState(false);
  const { mutateAsync: emailReceipt } = useEmailBlendReceipt();
  const { mutateAsync: createReceiptLink } = useCreateBlendReceiptLink();
  // Selected customer's contact info, used to pre-fill the send dialog.
  const { data: receiptCustomer } = useGetCustomer(customerId ?? 0, {
    query: {
      queryKey: getGetCustomerQueryKey(customerId ?? 0),
      enabled: customerId != null,
    },
  });
  // Pre-fill recipient from the selected customer without clobbering edits:
  // switching customers resets the fields; while the dialog is open (or the
  // fields are empty) an arriving fetch fills in the blanks only.
  useEffect(() => {
    setReceiptEmail(receiptCustomer?.email ?? "");
    setReceiptPhone(receiptCustomer?.phone ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);
  useEffect(() => {
    if (!receiptCustomer) return;
    setReceiptEmail((prev) => prev || (receiptCustomer.email ?? ""));
    setReceiptPhone((prev) => prev || (receiptCustomer.phone ?? ""));
  }, [receiptCustomer]);

  const { mutateAsync: createDryBlend } = useCreateDryBlendSave();
  const { mutateAsync: createLiquidBlend } = useCreateBlendSave();
  const { mutateAsync: createWorkOrder } = useCreateWorkOrder();
  const { mutateAsync: addItem } = useAddWorkOrderItem();

  // Per-product nutrient analysis (no bulk endpoint) and weighted-average cost.
  const analysisResults = useQueries({
    queries: components.map((c) => getGetProductNutrientAnalysisQueryOptions(c.productId)),
  });
  const { data: costRows } = useGetWeightedAverageCost();

  const analysisMap = useMemo<AnalysisMap>(() => {
    const map: AnalysisMap = {};
    analysisResults.forEach((r) => {
      const a = r.data;
      if (a) map[a.productId] = a;
    });
    return map;
  }, [analysisResults]);

  const costMap = useMemo<CostMap>(() => {
    const map: CostMap = {};
    (costRows ?? []).forEach((row) => {
      map[row.productId] = row.avgUnitCost;
    });
    return map;
  }, [costRows]);

  const analysisLoading = analysisResults.some((r) => r.isLoading);
  const analysis = useMemo(
    () => computeAnalysis(mode, components, analysisMap),
    [mode, components, analysisMap],
  );
  const costMargin = useMemo(
    () => computeCostMargin(mode, components, analysisMap, costMap),
    [mode, components, analysisMap, costMap],
  );

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  const totalQty = analysis.totalQty;
  const acresNum = parseFloat(acres) || 0;
  const rateNum = parseFloat(ratePerAcre) || 0;

  // Detailed liquid nutrient profile (guaranteed vs effective) and the
  // application rate chart — mirrors the web AgroLiquid calculator.
  const liquidProfile = useMemo(
    () => (mode === "liquid" ? computeLiquidProfile(components, analysisMap) : []),
    [mode, components, analysisMap],
  );
  const effNutrients = useMemo(
    () => liquidProfile.filter((n) => n.effPerGal > 0),
    [liquidProfile],
  );
  const rateChartRows = useMemo(
    () =>
      mode === "liquid" && rateNum > 0 && effNutrients.length > 0
        ? buildRateChartRows(rateNum, effNutrients, costMargin.salePerUnit)
        : [],
    [mode, rateNum, effNutrients, costMargin.salePerUnit],
  );

  const addProduct = (p: PickedProduct) => {
    setShowProducts(false);
    setComponents((prev) => {
      if (prev.some((c) => c.productId === p.id)) return prev;
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unit: p.unit ?? null,
          price: p.price ?? 0,
          cost: p.cost ?? null,
          qty: 0,
        },
      ];
    });
    setQtyTexts((prev) => {
      const { [p.id]: _drop, ...rest } = prev;
      return rest;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const setQty = (productId: number, raw: string) => {
    // Keep the raw text the user typed (so ".", "0.", "1.5" survive keystroke
    // by keystroke) and derive the numeric qty from it. Allow digits and a
    // single decimal point; treat "," as "." for locales that type it.
    let text = raw.replace(/,/g, ".").replace(/[^0-9.]/g, "");
    const firstDot = text.indexOf(".");
    if (firstDot !== -1) {
      text = text.slice(0, firstDot + 1) + text.slice(firstDot + 1).replace(/\./g, "");
    }
    setQtyTexts((prev) => ({ ...prev, [productId]: text }));
    const parsed = parseFloat(text);
    // Clamp to non-negative — a negative quantity would distort batch totals,
    // nutrient shares, and the scaled order quantities.
    const qty = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    setComponents((prev) =>
      prev.map((c) => (c.productId === productId ? { ...c, qty } : c)),
    );
  };

  const removeComponent = (productId: number) => {
    setComponents((prev) => prev.filter((c) => c.productId !== productId));
    setQtyTexts((prev) => {
      const { [productId]: _drop, ...rest } = prev;
      return rest;
    });
  };

  const selectCustomer = (id: number, cname: string) => {
    setCustomerId(id);
    setCustomerName(cname);
    setFieldId(null);
    setFieldName("");
    setShowCustomers(false);
  };

  const canSave = name.trim().length > 0 && components.length > 0 && totalQty > 0;

  // ---- Customer-facing blend receipt (email / text), mirrors the web calculator ----
  const canSendReceipt = mode === "liquid" && totalQty > 0 && rateNum > 0;

  const buildReceiptData = (): BlendReceiptData => {
    const totalCost = costMargin.salePerUnit * totalQty;
    return {
      title: "AgroLiquid Blend Recommendation",
      customerName: customerName.trim() || null,
      ratePerAcre: rateNum,
      totalGallons: totalQty,
      // Only rows that actually go into the batch — an unused zero-qty row
      // must not show up as a $0 line on the customer's document.
      products: components.filter((c) => c.qty > 0).map((c) => {
        const pricePerGal = toPerGallonPrice(c.price, c.unit, analysisMap[c.productId]?.lbsPerGal);
        return {
          productName: c.name,
          gallons: c.qty,
          pricePerGal,
          lineTotal: c.qty * pricePerGal,
        };
      }),
      nutrients: effNutrients.map((n) => ({
        label: n.label,
        lbsPerGal: n.effPerGal,
        lbsPerAcre: n.effPerGal * rateNum,
      })),
      rateChart: rateChartRows.length
        ? {
            nutrientLabels: effNutrients.map((n) => n.label),
            rows: rateChartRows.map((r) => ({
              rate: r.rate,
              values: r.values,
              costPerAcre: r.costPerAcre,
            })),
          }
        : null,
      totalCost,
      costPerAcre: costMargin.salePerUnit * rateNum,
    };
  };

  const openReceiptDialog = () => setReceiptOpen(true);

  const handleSendReceipt = async () => {
    const isSms = receiptChannel === "sms";
    if (isSms && !receiptPhone.trim()) {
      Alert.alert("Missing phone", "Enter a phone number to text the blend to.");
      return;
    }
    if (!isSms && !receiptEmail.trim()) {
      Alert.alert("Missing email", "Enter an email address to send the blend to.");
      return;
    }
    setSendingReceipt(true);
    try {
      if (isSms) {
        // Mint a secure link, then hand the message to the phone's own
        // messaging app — the text goes out from the rep's number.
        const link = await createReceiptLink({
          data: {
            ...(customerId != null ? { customerId } : {}),
            data: buildReceiptData(),
          },
        });
        const phone = receiptPhone.trim().replace(/[^\d+]/g, "");
        const sep = Platform.OS === "ios" ? "&" : "?";
        const smsUrl = `sms:${phone}${sep}body=${encodeURIComponent(link.message)}`;
        setReceiptOpen(false);
        await Linking.openURL(smsUrl);
      } else {
        const outcome = await emailReceipt({
          data: {
            recipient: receiptEmail.trim(),
            channel: "email",
            ...(customerId != null ? { customerId } : {}),
            data: buildReceiptData(),
          },
        });
        if (outcome.status === "sent") {
          setReceiptOpen(false);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            "Blend emailed",
            `Emailed the blend and performance charts to ${outcome.recipient}.`,
          );
        } else {
          Alert.alert("Could not send", outcome.reason ?? outcome.error ?? "Unknown error");
        }
      }
    } catch {
      Alert.alert("Could not send", "Check your connection and try again.");
    } finally {
      setSendingReceipt(false);
    }
  };
  const canPush = canSave && customerId != null && acresNum > 0 && rateNum > 0;

  const saveBlend = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (mode === "dry") {
        await createDryBlend({
          data: {
            name: name.trim(),
            customerId: customerId ?? undefined,
            fieldId: fieldId ?? undefined,
            notes: notes.trim() || undefined,
            components: components
              .filter((c) => c.qty > 0)
              .map((c) => ({ productId: c.productId, lbsToMix: c.qty })),
            ratePerAcre: rateNum > 0 ? rateNum : undefined,
          },
        });
      } else {
        await createLiquidBlend({
          data: {
            name: name.trim(),
            customerId: customerId ?? undefined,
            fieldId: fieldId ?? undefined,
            notes: notes.trim() || undefined,
            components: components
              .filter((c) => c.qty > 0)
              .map((c) => ({ productId: c.productId, gallonsToMix: c.qty })),
            ratePerAcre: rateNum > 0 ? rateNum : undefined,
          },
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Blend saved", `"${name.trim()}" was saved.`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't save", "Saving the blend failed. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const pushToOrder = async () => {
    if (!canPush || !customerId || pushing) return;
    if (!isOnline) {
      Alert.alert(
        "You're offline",
        `Adding a blend to ${isQuote ? "a quote" : "an order"} needs a connection. Save the blend now and add it once you're back online.`,
      );
      return;
    }
    setPushing(true);
    const comboKey = newComboMixKey();
    const lines = buildOrderLines(mode, components, analysisMap, acresNum, rateNum, comboKey);
    if (lines.length === 0) {
      setPushing(false);
      Alert.alert("Nothing to add", "Enter quantities, acres, and a rate per acre first.");
      return;
    }
    try {
      const order = await createWorkOrder({
        data: {
          customerId,
          status: isQuote ? "draft" : "submitted",
          notes: `${mode === "dry" ? "Dry" : "Liquid"} blend: ${name.trim()}${
            fieldName ? ` (${fieldName})` : ""
          }`,
        },
      });
      const failed: string[] = [];
      for (const line of lines) {
        try {
          await addItem({ id: order.id, data: line });
        } catch {
          const comp = components.find((c) => c.productId === line.productId);
          failed.push(comp?.name ?? `#${line.productId}`);
        }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (failed.length > 0) {
        Alert.alert(
          isQuote ? "Quote created with issues" : "Order created with issues",
          `These lines couldn't be added (margin floor or pricing): ${failed.join(", ")}. Open the ${
            isQuote ? "quote" : "order"
          } to finish.`,
          [{ text: "Open", onPress: () => router.replace(`/order/${order.id}`) }],
        );
      } else {
        Alert.alert(
          isQuote ? "Quote created" : "Order created",
          `Added ${lines.length} line${lines.length !== 1 ? "s" : ""} from "${name.trim()}".`,
          [{ text: "Open", onPress: () => router.replace(`/order/${order.id}`) }],
        );
      }
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't create order", "Creating the order failed. Check your connection and try again.");
    } finally {
      setPushing(false);
    }
  };

  const title = mode === "dry" ? "Dry Blend" : "Liquid Blend";

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.topBar,
          { paddingTop: topPadding + 8, backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.foreground }]}>{title}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 60, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Blend name */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Blend name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder={mode === "dry" ? "e.g. Corn Starter 12-40-0" : "e.g. Foliar Boost"}
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
          />
        </View>

        {/* Components */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Products</Text>
          {components.length === 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Add products and enter how many {qtyLabel(mode)} of each go into the batch.
            </Text>
          ) : null}
          {components.map((c) => (
            <View
              key={c.productId}
              style={[styles.compRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.compName, { color: colors.foreground }]} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={[styles.compMeta, { color: colors.mutedForeground }]}>
                  ${c.price.toFixed(2)}/{c.unit || "unit"}
                </Text>
              </View>
              <TextInput
                style={[styles.qtyInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
                value={qtyTexts[c.productId] ?? (c.qty ? String(c.qty) : "")}
                onChangeText={(t) => setQty(c.productId, t)}
                keyboardType="decimal-pad"
              />
              <Text style={[styles.qtyUnit, { color: colors.mutedForeground }]}>{qtyLabel(mode)}</Text>
              <Pressable onPress={() => removeComponent(c.productId)} hitSlop={8} style={{ paddingLeft: 4 }}>
                <Feather name="trash-2" size={18} color={colors.destructive} />
              </Pressable>
            </View>
          ))}
          <Pressable
            style={[styles.addBtn, { borderColor: colors.primary }]}
            onPress={() => setShowProducts(true)}
          >
            <Feather name="plus" size={16} color={colors.primary} />
            <Text style={[styles.addBtnText, { color: colors.primary }]}>Add product</Text>
          </Pressable>
          <View style={[styles.rateRow, { marginTop: 12 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Acres</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
                value={acres}
                onChangeText={setAcres}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Rate ({rateLabel(mode)})</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
                value={ratePerAcre}
                onChangeText={setRatePerAcre}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          {acresNum > 0 && rateNum > 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: 6 }]}>
              Applies {(acresNum * rateNum).toLocaleString(undefined, { maximumFractionDigits: 1 })}{" "}
              {qtyLabel(mode)} total across {acresNum} acres.
            </Text>
          ) : null}
        </View>

        {/* Analysis */}
        {components.length > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Analysis</Text>
              {analysisLoading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            </View>
            <View style={styles.totalsRow}>
              <Text style={[styles.totalsText, { color: colors.mutedForeground }]}>
                Batch: {totalQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} {qtyLabel(mode)}
                {mode === "dry" && totalQty > 0
                  ? ` (${(totalQty / 2000).toLocaleString(undefined, { maximumFractionDigits: 2 })} ton)`
                  : ""}
              </Text>
            </View>
            {analysis.nutrients.length === 0 ? (
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                No nutrient data yet — enter quantities to see the grade.
              </Text>
            ) : (
              <View style={{ marginTop: 4 }}>
                <View style={[styles.tHead, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.thNutrient, { color: colors.mutedForeground }]}>Nutrient</Text>
                  {mode === "dry" ? (
                    <Text style={[styles.thNum, { color: colors.mutedForeground }]}>Grade %</Text>
                  ) : null}
                  <Text style={[styles.thNum, { color: colors.mutedForeground }]}>{analysis.perUnitLabel}</Text>
                  <Text style={[styles.thNum, { color: colors.mutedForeground }]}>Total lb</Text>
                </View>
                {analysis.nutrients.map((n) => (
                  <View key={n.key} style={styles.tRow}>
                    <Text style={[styles.tdNutrient, { color: colors.foreground }]}>{n.label}</Text>
                    {mode === "dry" ? (
                      <Text style={[styles.tdNum, { color: colors.foreground }]}>
                        {(n.grade ?? 0).toFixed(2)}
                      </Text>
                    ) : null}
                    <Text style={[styles.tdNum, { color: colors.foreground }]}>{n.perUnit.toFixed(2)}</Text>
                    <Text style={[styles.tdNum, { color: colors.foreground }]}>
                      {n.totalLbs.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {/* Cost & margin (internal figures hidden in customer mode) */}
            <View style={[styles.costBox, { borderTopColor: colors.border }]}>
              <View style={styles.costRow}>
                <Text style={[styles.costLabel, { color: colors.mutedForeground }]}>Price / {costMargin.unitLabel}</Text>
                <Text style={[styles.costValue, { color: colors.foreground }]}>${costMargin.salePerUnit.toFixed(2)}</Text>
              </View>
              {!customerMode ? (
                <>
                  <View style={styles.costRow}>
                    <Text style={[styles.costLabel, { color: colors.mutedForeground }]}>Cost / {costMargin.unitLabel}</Text>
                    <Text style={[styles.costValue, { color: colors.foreground }]}>${costMargin.costPerUnit.toFixed(2)}</Text>
                  </View>
                  <View style={styles.costRow}>
                    <Text style={[styles.costLabel, { color: colors.mutedForeground }]}>Margin</Text>
                    <Text
                      style={[
                        styles.costValue,
                        {
                          color:
                            costMargin.marginPct == null
                              ? colors.mutedForeground
                              : costMargin.marginPct < 0
                                ? colors.destructive
                                : colors.primary,
                        },
                      ]}
                    >
                      {costMargin.marginPct == null ? "—" : `${costMargin.marginPct.toFixed(1)}%`}
                    </Text>
                  </View>
                  {costMargin.missingCost ? (
                    <Text style={[styles.warnText, { color: colors.warning }]}>
                      Some products have no cost on file — margin is an estimate.
                    </Text>
                  ) : null}
                </>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Nutrient profile (liquid): guaranteed vs effective, per gal & per acre */}
        {mode === "liquid" && components.length > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Nutrient profile</Text>
            <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: 4 }]}>
              Guar. = label analysis. Eff. = research-based expected performance. Per-acre uses your rate below.
            </Text>
            {liquidProfile.length === 0 ? (
              <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: 8 }]}>
                Enter quantities to see the nutrient profile.
              </Text>
            ) : (
              <View style={{ marginTop: 8 }}>
                <View style={[styles.tHead, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.thNutrient, { color: colors.mutedForeground }]}>Nutrient</Text>
                  <Text style={[styles.thNum, { color: colors.mutedForeground }]}>Guar/gal</Text>
                  <Text style={[styles.thNum, { color: colors.mutedForeground }]}>Guar/ac</Text>
                  <Text style={[styles.thNum, { color: colors.mutedForeground }]}>Eff/gal</Text>
                  <Text style={[styles.thNum, { color: colors.mutedForeground }]}>Eff/ac</Text>
                </View>
                {liquidProfile.map((n) => (
                  <View key={n.key} style={styles.tRow}>
                    <Text style={[styles.tdNutrient, { color: colors.foreground }]}>{n.label}</Text>
                    <Text style={[styles.tdNum, { color: colors.foreground }]}>{n.guarPerGal.toFixed(3)}</Text>
                    <Text style={[styles.tdNum, { color: colors.foreground }]}>{(n.guarPerGal * rateNum).toFixed(2)}</Text>
                    <Text style={[styles.tdNum, { color: colors.primary }]}>{n.effPerGal.toFixed(3)}</Text>
                    <Text style={[styles.tdNum, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                      {(n.effPerGal * rateNum).toFixed(2)}
                    </Text>
                  </View>
                ))}
                {rateNum <= 0 ? (
                  <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: 8 }]}>
                    Set a rate ({rateLabel(mode)}) under “Products” above to fill in the per-acre columns.
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        ) : null}

        {/* Application rate chart (liquid) */}
        {mode === "liquid" && components.length > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Application rate chart</Text>
            {rateChartRows.length === 0 ? (
              <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: 8 }]}>
                {totalQty > 0 && rateNum > 0
                  ? "These products don't have nutrient analysis data on file yet — an admin can add it on the web app."
                  : "Enter quantities and a rate per acre to see effective nutrients at rates around your target."}
              </Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                <View>
                  <View style={[styles.tHead, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.thChartCol, { color: colors.mutedForeground }]}>Rate</Text>
                    {effNutrients.map((n) => (
                      <Text key={n.key} style={[styles.thChartCol, { color: colors.mutedForeground }]}>
                        {n.label}
                      </Text>
                    ))}
                    <Text style={[styles.thChartCol, { color: colors.mutedForeground }]}>$/ac</Text>
                  </View>
                  {rateChartRows.map((r) => {
                    const isTarget = Math.abs(r.rate - rateNum) < 1e-6;
                    return (
                      <View
                        key={r.rate}
                        style={[styles.tRow, isTarget ? { backgroundColor: colors.primary + "1A", borderRadius: 6 } : null]}
                      >
                        <Text
                          style={[
                            styles.tdChartCol,
                            { color: isTarget ? colors.primary : colors.foreground },
                            isTarget ? { fontFamily: "Inter_700Bold" } : null,
                          ]}
                        >
                          {r.rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          {isTarget ? " ◀" : ""}
                        </Text>
                        {r.values.map((v, i) => (
                          <Text key={i} style={[styles.tdChartCol, { color: colors.foreground }]}>
                            {v.toFixed(2)}
                          </Text>
                        ))}
                        <Text style={[styles.tdChartCol, { color: colors.foreground }]}>${r.costPerAcre.toFixed(2)}</Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            )}
            <Pressable
              style={[
                styles.addBtn,
                { borderColor: colors.primary, marginTop: 12, opacity: canSendReceipt && isOnline ? 1 : 0.5 },
              ]}
              onPress={openReceiptDialog}
              disabled={!canSendReceipt || !isOnline}
            >
              <Feather name="send" size={16} color={colors.primary} />
              <Text style={[styles.addBtnText, { color: colors.primary }]}>Email / text to customer</Text>
            </Pressable>
            {!canSendReceipt ? (
              <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: 6 }]}>
                Enter quantities and a rate per acre to send the blend and charts.
              </Text>
            ) : !isOnline ? (
              <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: 6 }]}>
                You're offline — sending needs a connection.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Customer & field (optional) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Customer & field</Text>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Optional for saving. Required to push onto an order or quote.
          </Text>
          <Pressable
            style={[styles.pickerRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowCustomers(true)}
          >
            <Feather name="user" size={16} color={colors.mutedForeground} />
            <Text
              style={[
                styles.pickerText,
                { color: customerId ? colors.foreground : colors.mutedForeground },
              ]}
              numberOfLines={1}
            >
              {customerName || "Select customer"}
            </Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
          {customerId ? (
            <Pressable
              style={[styles.pickerRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setShowFields(true)}
            >
              <Feather name="map-pin" size={16} color={colors.mutedForeground} />
              <Text
                style={[
                  styles.pickerText,
                  { color: fieldId ? colors.foreground : colors.mutedForeground },
                ]}
                numberOfLines={1}
              >
                {fieldName || "Select field (optional)"}
              </Text>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        {/* Notes */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Notes</Text>
          <TextInput
            style={[styles.input, styles.notes, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder="Optional notes"
            placeholderTextColor={colors.mutedForeground}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
        </View>

        {/* Save */}
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: canSave && !saving ? 1 : 0.5 }]}
          onPress={saveBlend}
          disabled={!canSave || saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Feather name="save" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Save blend</Text>
            </>
          )}
        </Pressable>

        {/* Send to order */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 12 }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Send to order</Text>
          {acresNum > 0 && rateNum > 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Applies {(acresNum * rateNum).toLocaleString(undefined, { maximumFractionDigits: 1 })}{" "}
              {qtyLabel(mode)} total across {acresNum} acres.
            </Text>
          ) : null}
          <View style={[styles.toggleRow, { borderColor: colors.border }]}>
            <Pressable
              style={[styles.toggleBtn, { backgroundColor: isQuote ? colors.primary : "transparent" }]}
              onPress={() => setIsQuote(true)}
            >
              <Text style={[styles.toggleText, { color: isQuote ? "#fff" : colors.mutedForeground }]}>Quote</Text>
            </Pressable>
            <Pressable
              style={[styles.toggleBtn, { backgroundColor: !isQuote ? colors.primary : "transparent" }]}
              onPress={() => setIsQuote(false)}
            >
              <Text style={[styles.toggleText, { color: !isQuote ? "#fff" : colors.mutedForeground }]}>Order</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: canPush && !pushing ? 1 : 0.5 }]}
            onPress={pushToOrder}
            disabled={!canPush || pushing}
          >
            {pushing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="shopping-cart" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>{isQuote ? "Create quote" : "Create order"}</Text>
              </>
            )}
          </Pressable>
          {!customerId ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>Select a customer to enable this.</Text>
          ) : null}
        </View>
      </ScrollView>

      <ProductPicker
        visible={showProducts}
        onClose={() => setShowProducts(false)}
        onSelect={addProduct}
        title="Add product to blend"
        calculatorMode={mode}
      />
      <CustomerPickerModal
        visible={showCustomers}
        onClose={() => setShowCustomers(false)}
        onSelect={selectCustomer}
      />
      {/* Send blend receipt (email / text) */}
      <Modal visible={receiptOpen} animationType="slide" onRequestClose={() => setReceiptOpen(false)}>
        <View style={[styles.modalRoot, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Send blend to customer</Text>
            <Pressable onPress={() => setReceiptOpen(false)} hitSlop={8}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              {receiptChannel === "sms"
                ? "Creates a secure link to the blend and charts, then opens your Messages app with the text ready to send from your own number."
                : "Sends the blend make-up, effective nutrient profile, and application rate chart by email."}
            </Text>
            <View style={[styles.toggleRow, { borderColor: colors.border }]}>
              <Pressable
                style={[styles.toggleBtn, { backgroundColor: receiptChannel === "email" ? colors.primary : "transparent" }]}
                onPress={() => setReceiptChannel("email")}
              >
                <Text style={[styles.toggleText, { color: receiptChannel === "email" ? "#fff" : colors.mutedForeground }]}>
                  Email
                </Text>
              </Pressable>
              <Pressable
                style={[styles.toggleBtn, { backgroundColor: receiptChannel === "sms" ? colors.primary : "transparent" }]}
                onPress={() => setReceiptChannel("sms")}
              >
                <Text style={[styles.toggleText, { color: receiptChannel === "sms" ? "#fff" : colors.mutedForeground }]}>
                  Text
                </Text>
              </Pressable>
            </View>
            {receiptChannel === "email" ? (
              <View style={styles.section}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Email address</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="customer@example.com"
                  placeholderTextColor={colors.mutedForeground}
                  value={receiptEmail}
                  onChangeText={setReceiptEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ) : (
              <View style={styles.section}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Phone number</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="(555) 555-5555"
                  placeholderTextColor={colors.mutedForeground}
                  value={receiptPhone}
                  onChangeText={setReceiptPhone}
                  keyboardType="phone-pad"
                />
              </View>
            )}
            {customerName ? (
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                Sending as a recommendation for {customerName}.
              </Text>
            ) : null}
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: sendingReceipt ? 0.5 : 1 }]}
              onPress={handleSendReceipt}
              disabled={sendingReceipt}
            >
              {sendingReceipt ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Feather name="send" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>
                    {receiptChannel === "sms" ? "Open in Messages" : "Email blend"}
                  </Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <FieldPickerModal
        visible={showFields}
        customerId={customerId}
        onClose={() => setShowFields(false)}
        onSelect={(id, fname) => {
          setFieldId(id);
          setFieldName(fname);
          setShowFields(false);
        }}
      />
    </View>
  );
}

function CustomerPickerModal({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (id: number, name: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const { data: customers, isLoading } = useListCustomers({ search: search || undefined });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Select customer</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <View style={{ padding: 16 }}>
          <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search customers…"
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
        </View>
        <FlatList
          data={customers ?? []}
          keyExtractor={(item) => String(item.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No customers found</Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.modalRow, { borderBottomColor: colors.border }]}
              onPress={() => onSelect(item.id, item.name)}
            >
              <Text style={[styles.modalRowText, { color: colors.foreground }]}>{item.name}</Text>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

function FieldPickerModal({
  visible,
  customerId,
  onClose,
  onSelect,
}: {
  visible: boolean;
  customerId: number | null;
  onClose: () => void;
  onSelect: (id: number, name: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: fields, isLoading } = useListCustomerFields(customerId ?? 0, {
    query: {
      queryKey: getListCustomerFieldsQueryKey(customerId ?? 0),
      enabled: visible && customerId != null,
    },
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Select field</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <FlatList
          data={fields ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 8 }}
          ListEmptyComponent={
            isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No fields for this customer</Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.modalRow, { borderBottomColor: colors.border }]}
              onPress={() => onSelect(item.id, item.name)}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalRowText, { color: colors.foreground }]}>{item.name}</Text>
                {item.acres ? (
                  <Text style={[styles.compMeta, { color: colors.mutedForeground }]}>{item.acres} acres</Text>
                ) : null}
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        />
      </View>
    </Modal>
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
  section: { gap: 8 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  hint: { fontSize: 13, fontFamily: "Inter_400Regular" },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  notes: { height: 80, paddingTop: 12, textAlignVertical: "top" },
  compRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  compName: { fontSize: 15, fontFamily: "Inter_500Medium" },
  compMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  qtyInput: {
    width: 70,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    height: 38,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    textAlign: "right",
  },
  qtyUnit: { fontSize: 12, fontFamily: "Inter_400Regular", width: 26 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: "dashed",
    paddingVertical: 12,
    gap: 6,
  },
  addBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 12, borderWidth: 1, padding: 14 },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  totalsRow: { marginTop: 4 },
  totalsText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  tHead: {
    flexDirection: "row",
    paddingBottom: 6,
    marginBottom: 4,
    borderBottomWidth: 1,
  },
  thNutrient: { flex: 1.2, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  thNum: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "right" },
  tRow: { flexDirection: "row", paddingVertical: 4 },
  thChartCol: { width: 64, fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "right" },
  tdChartCol: { width: 64, fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "right" },
  tdNutrient: { flex: 1.2, fontSize: 14, fontFamily: "Inter_500Medium" },
  tdNum: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "right" },
  costBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, gap: 6 },
  costRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  costLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  costValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  warnText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 48,
    gap: 10,
  },
  pickerText: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  rateRow: { flexDirection: "row", gap: 12 },
  toggleRow: { flexDirection: "row", borderRadius: 10, borderWidth: 1, padding: 3, gap: 3 },
  toggleBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 8 },
  toggleText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 15,
    gap: 8,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  modalRoot: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
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
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalRowText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  emptyText: { textAlign: "center", marginTop: 40, fontSize: 14, fontFamily: "Inter_400Regular" },
});
