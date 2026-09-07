import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
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
  useAcknowledgeMargin,
  useAddWorkOrderItem,
  useCreateWorkOrder,
  useListCustomers,
  useListProducts,
  useListSites,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import {
  computeOrderMarginSummary,
  confirmThinMargin,
  LowMarginBadge,
  MarginFloorWarning,
  OrderMarginSummaryRow,
  thinMarginWarning,
  type MarginFloorInfo,
} from "@/components/MarginFloorWarning";
import { MediaGallery } from "@/components/MediaGallery";
import { QtyStepper } from "@/components/QtyStepper";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

interface LineItem extends MarginFloorInfo {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  cost?: number | null;
}

export default function NewOrderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isOnline, queueWrite } = useOffline();

  const [step, setStep] = useState(1);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedCustomerName, setSelectedCustomerName] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [freightCost, setFreightCost] = useState("");
  const [isQuote, setIsQuote] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState<number | null>(null);

  const { data: customers, isLoading: customersLoading } = useListCustomers({
    search: customerSearch || undefined,
  });
  const { data: products, isLoading: productsLoading } = useListProducts({
    search: productSearch || undefined,
  });
  const { data: sites } = useListSites({ inventoryOnly: true });

  const { mutateAsync: createWorkOrder } = useCreateWorkOrder();
  const { mutateAsync: addItem } = useAddWorkOrderItem();
  const { mutateAsync: acknowledgeMargin } = useAcknowledgeMargin();

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  const subtotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const freightAmount = parseFloat(freightCost) || 0;
  const total = subtotal + freightAmount;

  const addProduct = (
    product: {
      id: number;
      name: string;
      price?: number | null;
      cost?: number | null;
    } & MarginFloorInfo,
  ) => {
    const existing = lineItems.find((i) => i.productId === product.id);
    if (existing) {
      setLineItems(
        lineItems.map((i) =>
          i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i,
        ),
      );
    } else {
      setLineItems([
        ...lineItems,
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: product.price ?? 0,
          cost: product.cost,
          belowMarginFloor: product.belowMarginFloor,
          marginPct: product.marginPct,
          marginFloorPct: product.marginFloorPct,
          marginFloorSource: product.marginFloorSource,
        },
      ]);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const updateQty = (productId: number, qty: number) => {
    if (qty <= 0) {
      setLineItems(lineItems.filter((i) => i.productId !== productId));
    } else {
      setLineItems(lineItems.map((i) => (i.productId === productId ? { ...i, quantity: qty } : i)));
    }
  };

  const submitOrder = async () => {
    if (!selectedCustomerId || lineItems.length === 0) return;
    const proceed = await confirmThinMargin(
      lineItems,
      isQuote ? "Save Quote" : "Submit Order",
    );
    if (!proceed) return;
    setIsSubmitting(true);
    const orderStatus = isQuote ? "draft" : "submitted";
    // When the rep proceeded past a thin-margin warning, capture an audit
    // acknowledgement server-side so managers can see who knowingly pushed a
    // below-floor deal through. Only set when there's actually a warning.
    const marginSummary = computeOrderMarginSummary(lineItems);
    const acknowledgeThinMargin = thinMarginWarning(lineItems) != null;
    const payload = {
      customerId: selectedCustomerId,
      deliverySiteId: selectedSiteId ?? undefined,
      notes: notes.trim() || undefined,
      status: orderStatus,
      freightCost: freightAmount > 0 ? freightAmount : undefined,
      lineItems,
      marginWarningAcknowledged: acknowledgeThinMargin,
      blendedMarginPct: marginSummary.blendedMarginPct,
      belowFloorCount: marginSummary.belowFloorCount,
    };
    try {
      if (isOnline) {
        const order = await createWorkOrder({
          data: {
            customerId: selectedCustomerId,
            deliverySiteId: selectedSiteId ?? undefined,
            notes: notes.trim() || undefined,
            status: orderStatus,
            freightCost: freightAmount > 0 ? freightAmount : undefined,
          },
        });
        for (const item of lineItems) {
          await addItem({
            id: order.id,
            data: { productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice },
          });
        }
        if (acknowledgeThinMargin) {
          // Best-effort: an audit-logging failure must never block submission.
          try {
            await acknowledgeMargin({
              id: order.id,
              data: {
                blendedMarginPct: marginSummary.blendedMarginPct,
                belowFloorCount: marginSummary.belowFloorCount,
              },
            });
          } catch {
            // ignore; the order itself was created successfully
          }
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setCreatedOrderId(order.id);
      } else {
        await queueWrite("workOrder", payload);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back();
      }
    } catch {
      await queueWrite("workOrder", payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      router.back();
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
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
        <Pressable
          onPress={() => (step > 1 ? setStep(step - 1) : router.back())}
          style={styles.backBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.foreground }]}>New Order</Text>
        <View style={styles.steps}>
          {[1, 2, 3].map((s) => (
            <View
              key={s}
              style={[
                styles.stepDot,
                { backgroundColor: step >= s ? colors.primary : colors.muted },
              ]}
            />
          ))}
        </View>
      </View>

      {/* Step 1 — Select Customer */}
      {step === 1 ? (
        <View style={styles.stepWrap}>
          <Text style={[styles.stepTitle, { color: colors.foreground }]}>Select Customer</Text>
          <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search customers…"
              placeholderTextColor={colors.mutedForeground}
              value={customerSearch}
              onChangeText={setCustomerSearch}
              autoFocus
            />
          </View>
          <FlatList
            data={customers ?? []}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
            renderItem={({ item }) => (
              <Pressable
                style={[
                  styles.listRow,
                  {
                    backgroundColor:
                      selectedCustomerId === item.id ? colors.accent : colors.card,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => {
                  setSelectedCustomerId(item.id);
                  setSelectedCustomerName(item.name);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setStep(2);
                }}
              >
                <Text style={[styles.listRowText, { color: colors.foreground }]}>{item.name}</Text>
                {item.territory ? (
                  <Text style={[styles.listRowMeta, { color: colors.mutedForeground }]}>
                    {item.territory}
                  </Text>
                ) : null}
              </Pressable>
            )}
            ListEmptyComponent={
              customersLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
              ) : (
                <EmptyState icon="users" title="No customers found" />
              )
            }
            showsVerticalScrollIndicator={false}
          />
        </View>
      ) : null}

      {/* Step 2 — Add Products */}
      {step === 2 ? (
        <View style={styles.stepWrap}>
          <Text style={[styles.stepTitle, { color: colors.foreground }]}>Add Products</Text>
          <Text style={[styles.stepSubtitle, { color: colors.mutedForeground }]}>
            {selectedCustomerName}
          </Text>

          {lineItems.length > 0 ? (
            <View style={[styles.cartBar, { backgroundColor: colors.accent }]}>
              <Text style={[styles.cartText, { color: colors.accentForeground }]}>
                {lineItems.length} product{lineItems.length !== 1 ? "s" : ""} · ${subtotal.toFixed(2)}
              </Text>
              <Pressable
                style={[styles.nextBtn, { backgroundColor: colors.primary }]}
                onPress={() => setStep(3)}
              >
                <Text style={styles.nextBtnText}>Review →</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search products…"
              placeholderTextColor={colors.mutedForeground}
              value={productSearch}
              onChangeText={setProductSearch}
            />
          </View>

          <FlatList
            data={products ?? []}
            keyExtractor={(item) => String(item.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
            renderItem={({ item }) => {
              const inCart = lineItems.find((i) => i.productId === item.id);
              return (
                <View
                  style={[
                    styles.productRow,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.productInfo}>
                    <Text
                      style={[styles.productName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text style={[styles.productSku, { color: colors.mutedForeground }]}>
                      {item.sku ?? "No SKU"}
                    </Text>
                    {item.belowMarginFloor ? <LowMarginBadge style={{ marginTop: 4 }} /> : null}
                  </View>
                  {inCart ? (
                    <QtyStepper
                      value={inCart.quantity}
                      onChange={(qty) => updateQty(item.id, qty)}
                    />
                  ) : (
                    <Pressable
                      style={[styles.addBtn, { backgroundColor: colors.primary }]}
                      onPress={() => addProduct(item)}
                    >
                      <Feather name="plus" size={16} color="#fff" />
                    </Pressable>
                  )}
                </View>
              );
            }}
            ListEmptyComponent={
              productsLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
              ) : (
                <EmptyState icon="package" title="No products found" />
              )
            }
            showsVerticalScrollIndicator={false}
          />
        </View>
      ) : null}

      {/* Step 3 — Review & Submit */}
      {step === 3 ? (
        <ScrollView
          contentContainerStyle={[
            styles.reviewWrap,
            { paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.stepTitle, { color: colors.foreground }]}>Review Order</Text>

          <View style={[styles.reviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.reviewLabel, { color: colors.mutedForeground }]}>Customer</Text>
            <Text style={[styles.reviewValue, { color: colors.foreground }]}>
              {selectedCustomerName}
            </Text>
          </View>

          {sites && sites.length > 0 ? (
            <View style={[styles.reviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.reviewLabel, { color: colors.mutedForeground }]}>
                Ship From Site
              </Text>
              <View style={styles.sitePicker}>
                {sites.map((site) => (
                  <Pressable
                    key={site.id}
                    style={[
                      styles.siteChip,
                      {
                        borderColor:
                          selectedSiteId === site.id ? colors.primary : colors.border,
                        backgroundColor:
                          selectedSiteId === site.id ? colors.accent : "transparent",
                      },
                    ]}
                    onPress={() => setSelectedSiteId(site.id)}
                  >
                    <Text style={[styles.siteChipText, { color: colors.foreground }]}>
                      {site.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View style={[styles.reviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.reviewLabel, { color: colors.mutedForeground }]}>
              Products ({lineItems.length})
            </Text>
            {lineItems.map((item) => (
              <View key={item.productId}>
                <View style={styles.lineRow}>
                  <Text style={[styles.lineName, { color: colors.foreground }]} numberOfLines={1}>
                    {item.productName}
                  </Text>
                  <Text style={[styles.lineQty, { color: colors.mutedForeground }]}>
                    × {item.quantity}
                  </Text>
                  <Text style={[styles.linePrice, { color: colors.foreground }]}>
                    ${(item.quantity * item.unitPrice).toFixed(2)}
                  </Text>
                </View>
                <MarginFloorWarning info={item} />
              </View>
            ))}
            <View style={[styles.subtotalRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.subtotalLabel, { color: colors.mutedForeground }]}>Subtotal</Text>
              <Text style={[styles.subtotalValue, { color: colors.foreground }]}>
                ${subtotal.toFixed(2)}
              </Text>
            </View>
            <View style={styles.freightRow}>
              <Text style={[styles.subtotalLabel, { color: colors.mutedForeground }]}>
                Freight / Shipping ($)
              </Text>
              <TextInput
                style={[
                  styles.freightInput,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                value={freightCost}
                onChangeText={setFreightCost}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Total</Text>
              <Text style={[styles.totalValue, { color: colors.foreground }]}>
                ${total.toFixed(2)}
              </Text>
            </View>
            <OrderMarginSummaryRow items={lineItems} colors={colors} />
          </View>

          <TextInput
            style={[
              styles.notesInput,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
              },
            ]}
            placeholder="Order notes (optional)"
            placeholderTextColor={colors.mutedForeground}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
          />

          <View style={[styles.typeToggleRow, { borderColor: colors.border }]}>
            <Pressable
              style={[
                styles.typeToggleBtn,
                {
                  backgroundColor: !isQuote ? colors.primary : colors.card,
                  borderColor: !isQuote ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setIsQuote(false)}
            >
              <Feather name="shopping-cart" size={15} color={!isQuote ? "#fff" : colors.mutedForeground} />
              <Text style={[styles.typeToggleText, { color: !isQuote ? "#fff" : colors.mutedForeground }]}>
                Order
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.typeToggleBtn,
                {
                  backgroundColor: isQuote ? colors.primary : colors.card,
                  borderColor: isQuote ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setIsQuote(true)}
            >
              <Feather name="file-text" size={15} color={isQuote ? "#fff" : colors.mutedForeground} />
              <Text style={[styles.typeToggleText, { color: isQuote ? "#fff" : colors.mutedForeground }]}>
                Quote
              </Text>
            </Pressable>
          </View>
          {isQuote ? (
            <Text style={[styles.quoteHint, { color: colors.mutedForeground }]}>
              Saved as a draft quote — no inventory reserved until converted to an order.
            </Text>
          ) : null}

          {createdOrderId ? (
            <View style={{ gap: 16, marginTop: 8 }}>
              <View style={[styles.reviewCard, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 10 }]}>
                <Feather name="check-circle" size={20} color={colors.primary} />
                <Text style={[styles.reviewValue, { color: colors.foreground, flex: 1 }]}>
                  {isQuote ? "Quote saved" : "Order submitted"}. Add photos or videos below.
                </Text>
              </View>

              <View style={{ marginHorizontal: -16 }}>
                <MediaGallery context={{ workOrderId: createdOrderId }} title="Attachments" />
              </View>

              <Pressable
                style={[styles.submitBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.back()}
              >
                <Feather name="check" size={18} color="#fff" />
                <Text style={styles.submitBtnText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[
                styles.submitBtn,
                { backgroundColor: colors.primary, opacity: isSubmitting ? 0.6 : 1 },
              ]}
              onPress={submitOrder}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Feather name={isQuote ? "file-text" : "check"} size={18} color="#fff" />
                  <Text style={styles.submitBtnText}>{isQuote ? "Save Quote" : "Submit Order"}</Text>
                </>
              )}
            </Pressable>
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
  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  listRowText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  listRowMeta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  cartBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
  },
  cartText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  nextBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  nextBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  productRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    gap: 10,
  },
  productInfo: { flex: 1 },
  productName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  productSku: { fontSize: 12, fontFamily: "Inter_400Regular" },
  addBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  reviewWrap: { padding: 16, gap: 12 },
  reviewCard: { padding: 14, borderRadius: 10, borderWidth: 1, gap: 8 },
  reviewLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  reviewValue: { fontSize: 15, fontFamily: "Inter_500Medium" },
  sitePicker: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  siteChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  siteChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  lineName: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  lineQty: { fontSize: 13, fontFamily: "Inter_400Regular" },
  linePrice: { fontSize: 14, fontFamily: "Inter_600SemiBold", minWidth: 60, textAlign: "right" },
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
    borderTopWidth: 1,
    marginTop: 4,
  },
  subtotalLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  subtotalValue: { fontSize: 14, fontFamily: "Inter_500Medium" },
  freightRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
  },
  freightInput: {
    width: 110,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    textAlign: "right",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
    borderTopWidth: 1,
    marginTop: 4,
  },
  totalLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  totalValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  notesInput: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 80,
    textAlignVertical: "top",
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  typeToggleRow: {
    flexDirection: "row",
    gap: 8,
  },
  typeToggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  typeToggleText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  quoteHint: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: -4 },
});
