import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
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
  useGetWorkOrder,
  getGetWorkOrderQueryKey,
  useListWorkOrderItems,
  getListWorkOrderItemsQueryKey,
  useListProducts,
  getListProductsQueryKey,
  useAddWorkOrderItem,
  useUpdateWorkOrderItem,
  useDeleteWorkOrderItem,
  useUpdateWorkOrder,
  useListCustomerActivities,
  getListCustomerActivitiesQueryKey,
  useApproveMargin,
  useDenyMargin,
  useAcknowledgeMargin,
} from "@workspace/api-client-react";

import { ActivityItem } from "@/components/ActivityItem";
import { CustomerAdjustments } from "@/components/CustomerAdjustments";
import { EmptyState } from "@/components/EmptyState";
import { QtyStepper } from "@/components/QtyStepper";
import { QuickLogSheet } from "@/components/QuickLogSheet";
import type { PickedEntity } from "@/components/EntityPicker";
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
import { OfflineBanner } from "@/components/OfflineBanner";
import { useAppAuth } from "@/context/AuthContext";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import { usePermissions } from "@/lib/permissions";

const STATUS_STYLES: Record<string, { bg: string; fg: string }> = {
  draft: { bg: "#e7e7db", fg: "#6b756c" },
  submitted: { bg: "#dbeafe", fg: "#1d4ed8" },
  fulfilled: { bg: "#dcfce7", fg: "#15803d" },
  cancelled: { bg: "#fee2e2", fg: "#991b1b" },
};

interface DraftItem extends MarginFloorInfo {
  itemId?: number;
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  cost?: number | null;
}

export default function OrderDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string; focus?: string }>();
  const orderId = Number(params.id);
  const { currentMember } = useAppAuth();
  const { isOnline } = useOffline();
  const isManager =
    currentMember?.role === "manager" || currentMember?.role === "admin";
  const { canDo } = usePermissions();
  const canEditOrders = canDo("work_orders.edit");

  const enabled = Number.isFinite(orderId);
  const { data: order, isLoading } = useGetWorkOrder(orderId, {
    query: { enabled, queryKey: getGetWorkOrderQueryKey(orderId) },
  });
  const { data: items, isSuccess: itemsLoaded } = useListWorkOrderItems(orderId, {
    query: { enabled, queryKey: getListWorkOrderItemsQueryKey(orderId) },
  });

  const customerId = order?.customerId ?? 0;
  const { data: activities } = useListCustomerActivities(
    customerId,
    { workOrderId: orderId },
    {
      query: {
        enabled: enabled && !!customerId,
        queryKey: getListCustomerActivitiesQueryKey(customerId, {
          workOrderId: orderId,
        }),
      },
    },
  );

  const [isEditing, setIsEditing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [draftNotes, setDraftNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [marginNote, setMarginNote] = useState("");
  const [marginAction, setMarginAction] = useState<"approve" | "deny" | null>(null);

  // When a manager taps the below-floor alert (push deep link carries
  // `focus=margin`), scroll the margin approval banner into view so they land
  // directly on the approve/deny controls instead of hunting for it.
  const scrollRef = React.useRef<ScrollView>(null);
  const marginBannerY = React.useRef(0);
  const didFocusMargin = React.useRef(false);
  React.useEffect(() => {
    if (params.focus !== "margin" || didFocusMargin.current) return;
    const status = order?.marginApprovalStatus;
    if (!status || status === "not_required") return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(marginBannerY.current - 12, 0),
        animated: true,
      });
      didFocusMargin.current = true;
    }, 400);
    return () => clearTimeout(t);
  }, [params.focus, order?.marginApprovalStatus, order?.id]);

  const productParams = { search: productSearch || undefined };
  const { data: products, isLoading: productsLoading } = useListProducts(
    productParams,
    {
      query: {
        enabled: pickerVisible,
        queryKey: getListProductsQueryKey(productParams),
      },
    },
  );

  const { mutateAsync: addItem } = useAddWorkOrderItem();
  const { mutateAsync: updateItem } = useUpdateWorkOrderItem();
  const { mutateAsync: deleteItem } = useDeleteWorkOrderItem();
  const { mutateAsync: updateWorkOrder } = useUpdateWorkOrder();
  const { mutateAsync: approveMargin, isPending: isApproving } = useApproveMargin();
  const { mutateAsync: denyMargin, isPending: isDenying } = useDenyMargin();
  const { mutateAsync: acknowledgeMargin } = useAcknowledgeMargin();

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  const statusStyle = order
    ? STATUS_STYLES[order.status.toLowerCase()] ?? STATUS_STYLES.draft
    : STATUS_STYLES.draft;

  const logPreset = useMemo<PickedEntity | null>(() => {
    if (!order?.customerId) return null;
    return {
      entityType: "customer",
      id: order.customerId,
      name: order.customerName ?? `Customer #${order.customerId}`,
      subtitle: order.orderNumber ? `Order ${order.orderNumber}` : null,
    };
  }, [order?.customerId, order?.customerName, order?.orderNumber]);

  const draftTotal = useMemo(
    () => draftItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0),
    [draftItems],
  );
  // Combo-mix display labels: lines added together from one AgroLiquid blend
  // share a comboMixKey. A single blend reads "Combo Mix"; two or more get
  // "Combo Mix 1/2/…" so they can be told apart.
  const mixLabels = useMemo(() => {
    const order: string[] = [];
    for (const it of items ?? []) {
      const key = it.comboMixKey;
      if (key && !order.includes(key)) order.push(key);
    }
    const labels = new Map<string, string>();
    order.forEach((key, i) => {
      labels.set(key, order.length > 1 ? `Combo Mix ${i + 1}` : "Combo Mix");
    });
    return labels;
  }, [items]);
  const readTotal =
    order?.totalAmount ??
    (items ?? []).reduce((sum, item) => sum + (item.totalPrice ?? 0), 0);
  const total = isEditing ? draftTotal : readTotal;
  // Header-level freight charge, shown read-only in the cost breakdown. Hidden
  // while editing line items (totals there are a local product-only preview).
  const freight = !isEditing ? Number(order?.freightCost ?? 0) : 0;

  const startEditing = () => {
    if (!itemsLoaded) return;
    setDraftItems(
      (items ?? []).map((item) => ({
        itemId: item.id,
        productId: item.productId ?? 0,
        productName: item.productName ?? "Product",
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        cost: item.cost,
        belowMarginFloor: item.belowMarginFloor,
        marginPct: item.marginPct,
        marginFloorPct: item.marginFloorPct,
        marginFloorSource: item.marginFloorSource,
      })),
    );
    setDraftNotes(order?.notes ?? "");
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setDraftItems([]);
    setDraftNotes("");
    setPickerVisible(false);
    setProductSearch("");
  };

  const changeQty = (index: number, qty: number) => {
    setDraftItems((prev) => {
      if (qty <= 0) return prev.filter((_, i) => i !== index);
      return prev.map((item, i) => (i === index ? { ...item, quantity: qty } : item));
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const addProduct = (
    product: {
      id: number;
      name: string;
      price?: number | null;
      cost?: number | null;
    } & MarginFloorInfo,
  ) => {
    setDraftItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) =>
          i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      return [
        ...prev,
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
      ];
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const saveChanges = async () => {
    if (!order || !itemsLoaded) return;
    const proceed = await confirmThinMargin(draftItems, "Save Changes");
    if (!proceed) return;
    // If the rep proceeded past a thin-margin warning, capture an audit
    // acknowledgement server-side after the save succeeds (best-effort).
    const acknowledgeThinMargin = thinMarginWarning(draftItems) != null;
    const marginSummary = computeOrderMarginSummary(draftItems);
    setIsSaving(true);
    try {
      const original = items ?? [];

      for (const orig of original) {
        if (!draftItems.some((d) => d.itemId === orig.id)) {
          await deleteItem({ id: orig.id });
        }
      }

      for (const draft of draftItems) {
        if (draft.itemId) {
          const orig = original.find((o) => o.id === draft.itemId);
          if (orig && orig.quantity !== draft.quantity) {
            await updateItem({ id: draft.itemId, data: { quantity: draft.quantity } });
          }
        } else {
          await addItem({
            id: orderId,
            data: {
              productId: draft.productId,
              quantity: draft.quantity,
              unitPrice: draft.unitPrice,
            },
          });
        }
      }

      const trimmedNotes = draftNotes.trim();
      if ((order.notes ?? "") !== trimmedNotes) {
        await updateWorkOrder({ id: orderId, data: { notes: trimmedNotes } });
      }

      await queryClient.invalidateQueries({
        queryKey: getGetWorkOrderQueryKey(orderId),
      });
      await queryClient.invalidateQueries({
        queryKey: getListWorkOrderItemsQueryKey(orderId),
      });

      if (acknowledgeThinMargin) {
        // Best-effort: an audit-logging failure must never block the save.
        try {
          await acknowledgeMargin({
            id: orderId,
            data: {
              blendedMarginPct: marginSummary.blendedMarginPct,
              belowFloorCount: marginSummary.belowFloorCount,
            },
          });
          if (customerId) {
            await queryClient.invalidateQueries({
              queryKey: getListCustomerActivitiesQueryKey(customerId, {
                workOrderId: orderId,
              }),
            });
          }
        } catch {
          // ignore; the order changes were saved successfully
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      cancelEditing();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't save changes", "Please try again when you have a stable connection.");
    } finally {
      setIsSaving(false);
    }
  };

  const refreshMargin = async () => {
    await queryClient.invalidateQueries({
      queryKey: getGetWorkOrderQueryKey(orderId),
    });
    if (customerId) {
      await queryClient.invalidateQueries({
        queryKey: getListCustomerActivitiesQueryKey(customerId, {
          workOrderId: orderId,
        }),
      });
    }
  };

  const handleMarginApprove = async () => {
    setMarginAction("approve");
    try {
      await approveMargin({
        id: orderId,
        data: { note: marginNote.trim() || undefined },
      });
      await refreshMargin();
      setMarginNote("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't approve margin", "Please try again when you have a stable connection.");
    } finally {
      setMarginAction(null);
    }
  };

  const handleMarginDeny = async () => {
    setMarginAction("deny");
    try {
      await denyMargin({
        id: orderId,
        data: { note: marginNote.trim() || undefined },
      });
      await refreshMargin();
      setMarginNote("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't deny margin", "Please try again when you have a stable connection.");
    } finally {
      setMarginAction(null);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />
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
          onPress={() => (isEditing ? cancelEditing() : router.back())}
          style={styles.backBtn}
        >
          <Feather
            name={isEditing ? "x" : "arrow-left"}
            size={22}
            color={colors.foreground}
          />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.foreground }]} numberOfLines={1}>
          {isEditing
            ? "Edit Order"
            : order?.orderNumber
              ? `Order ${order.orderNumber}`
              : `Order #${orderId}`}
        </Text>
        {order && !isEditing ? (
          !isOnline ? (
            <Feather name="wifi-off" size={18} color={colors.mutedForeground} />
          ) : itemsLoaded && canEditOrders ? (
            <Pressable onPress={startEditing} style={styles.editBtn} hitSlop={8}>
              <Feather name="edit-2" size={18} color={colors.primary} />
            </Pressable>
          ) : !itemsLoaded ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : null
        ) : null}
      </View>

      {isLoading && !order ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !order ? (
        <EmptyState icon="clipboard" title="Order not found" />
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingBottom: insets.bottom + (isEditing ? 100 : 60) }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.section}>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.customer, { color: colors.foreground }]} numberOfLines={1}>
                  {order.customerName ?? `Order #${order.id}`}
                </Text>
                <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                  <Text style={[styles.statusText, { color: statusStyle.fg }]}>
                    {order.status?.toLowerCase() === "draft" ? "Quote" : order.status}
                  </Text>
                </View>
              </View>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {new Date(order.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {order.deliverySiteName ? ` · ${order.deliverySiteName}` : ""}
              </Text>
            </View>

            {order.marginApprovalStatus &&
              order.marginApprovalStatus !== "not_required" && (
                <View
                  onLayout={(e) => {
                    marginBannerY.current = e.nativeEvent.layout.y;
                  }}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.card,
                      borderColor:
                        order.marginApprovalStatus === "approved"
                          ? "#2c8537"
                          : order.marginApprovalStatus === "denied"
                            ? "#dc2626"
                            : "#d97706",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.marginBannerTitle,
                      {
                        color:
                          order.marginApprovalStatus === "approved"
                            ? "#2c8537"
                            : order.marginApprovalStatus === "denied"
                              ? "#dc2626"
                              : "#d97706",
                      },
                    ]}
                  >
                    {order.marginApprovalStatus === "pending"
                      ? "Margin approval required"
                      : order.marginApprovalStatus === "approved"
                        ? "Margin approved"
                        : "Margin denied"}
                  </Text>
                  {order.marginApprovalReason ? (
                    <Text
                      style={[styles.meta, { color: colors.mutedForeground, marginTop: 4 }]}
                    >
                      {order.marginApprovalReason}
                    </Text>
                  ) : null}
                  {order.marginApprovalNote ? (
                    <Text
                      style={[styles.meta, { color: colors.foreground, marginTop: 4 }]}
                    >
                      Manager note: {order.marginApprovalNote}
                    </Text>
                  ) : null}

                  {order.marginApprovalStatus === "pending" && isManager ? (
                    !isOnline ? (
                      <Text
                        style={[styles.meta, { color: colors.mutedForeground, marginTop: 8 }]}
                      >
                        Reconnect to approve or deny this order.
                      </Text>
                    ) : (
                      <View style={styles.marginActions}>
                        <TextInput
                          style={[
                            styles.notesInput,
                            { borderColor: colors.border, color: colors.foreground },
                          ]}
                          placeholder="Optional note for the rep…"
                          placeholderTextColor={colors.mutedForeground}
                          value={marginNote}
                          onChangeText={setMarginNote}
                          multiline
                          numberOfLines={2}
                          editable={!isApproving && !isDenying}
                        />
                        <View style={styles.marginBtnRow}>
                          <Pressable
                            style={[
                              styles.marginBtn,
                              {
                                backgroundColor: "#2c8537",
                                opacity: isApproving || isDenying ? 0.6 : 1,
                              },
                            ]}
                            onPress={handleMarginApprove}
                            disabled={isApproving || isDenying}
                          >
                            {marginAction === "approve" && isApproving ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <>
                                <Feather name="check" size={16} color="#fff" />
                                <Text style={styles.marginBtnText}>Approve</Text>
                              </>
                            )}
                          </Pressable>
                          <Pressable
                            style={[
                              styles.marginBtn,
                              {
                                backgroundColor: "#dc2626",
                                opacity: isApproving || isDenying ? 0.6 : 1,
                              },
                            ]}
                            onPress={handleMarginDeny}
                            disabled={isApproving || isDenying}
                          >
                            {marginAction === "deny" && isDenying ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <>
                                <Feather name="x" size={16} color="#fff" />
                                <Text style={styles.marginBtnText}>Deny</Text>
                              </>
                            )}
                          </Pressable>
                        </View>
                      </View>
                    )
                  ) : null}
                  {order.marginApprovalStatus === "pending" && !isManager ? (
                    <Text
                      style={[styles.meta, { color: colors.mutedForeground, marginTop: 8 }]}
                    >
                      Waiting on a manager to review the below-floor margin on this order.
                    </Text>
                  ) : null}
                </View>
              )}

            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>
                Products ({isEditing ? draftItems.length : items?.length ?? 0})
              </Text>

              {isEditing ? (
                <>
                  {draftItems.length > 0 ? (
                    draftItems.map((item, index) => (
                      <View key={item.itemId ?? `new-${item.productId}`}>
                      <View style={styles.editLineRow}>
                        <Text
                          style={[styles.lineName, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {item.productName}
                        </Text>
                        <QtyStepper
                          value={item.quantity}
                          onChange={(qty) => changeQty(index, qty)}
                        />
                        <Pressable
                          style={styles.removeBtn}
                          onPress={() => changeQty(index, 0)}
                          hitSlop={6}
                        >
                          <Feather name="trash-2" size={16} color="#991b1b" />
                        </Pressable>
                      </View>
                      <MarginFloorWarning info={item} />
                      </View>
                    ))
                  ) : (
                    <Text style={[styles.emptyLine, { color: colors.mutedForeground }]}>
                      No products yet
                    </Text>
                  )}
                  <Pressable
                    style={[styles.addProductBtn, { borderColor: colors.primary }]}
                    onPress={() => {
                      setProductSearch("");
                      setPickerVisible(true);
                    }}
                  >
                    <Feather name="plus" size={16} color={colors.primary} />
                    <Text style={[styles.addProductText, { color: colors.primary }]}>
                      Add product
                    </Text>
                  </Pressable>
                  <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
                    <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>
                      Total
                    </Text>
                    <Text style={[styles.totalValue, { color: colors.foreground }]}>
                      ${total.toFixed(2)}
                    </Text>
                  </View>
                  <OrderMarginSummaryRow items={draftItems} colors={colors} />
                </>
              ) : items && items.length > 0 ? (
                <>
                  {items.map((item) => {
                    const mixLabel = item.comboMixKey ? mixLabels.get(item.comboMixKey) : null;
                    return (
                    <View key={item.id}>
                    <View style={styles.lineRow}>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.lineName, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {item.productName ?? "Product"}
                        </Text>
                        {mixLabel ? (
                          <Text style={[styles.comboMixTag, { color: colors.primary }]}>
                            {mixLabel}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={[styles.lineQty, { color: colors.mutedForeground }]}>
                        × {item.quantity}
                      </Text>
                      <Text style={[styles.linePrice, { color: colors.foreground }]}>
                        ${(item.totalPrice ?? 0).toFixed(2)}
                      </Text>
                    </View>
                    <MarginFloorWarning info={item} />
                    </View>
                    );
                  })}
                  {freight > 0 ? (
                    <>
                      <View style={[styles.subtotalRow, { borderTopColor: colors.border }]}>
                        <Text style={[styles.subtotalLabel, { color: colors.mutedForeground }]}>
                          Subtotal
                        </Text>
                        <Text style={[styles.subtotalValue, { color: colors.mutedForeground }]}>
                          ${(total - freight).toFixed(2)}
                        </Text>
                      </View>
                      <View style={styles.subtotalRow}>
                        <Text style={[styles.subtotalLabel, { color: colors.mutedForeground }]}>
                          Freight / Shipping
                        </Text>
                        <Text style={[styles.subtotalValue, { color: colors.mutedForeground }]}>
                          ${freight.toFixed(2)}
                        </Text>
                      </View>
                    </>
                  ) : null}
                  <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
                    <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>
                      Total
                    </Text>
                    <Text style={[styles.totalValue, { color: colors.foreground }]}>
                      ${total.toFixed(2)}
                    </Text>
                  </View>
                  <OrderMarginSummaryRow items={items ?? []} colors={colors} />
                </>
              ) : (
                <Text style={[styles.emptyLine, { color: colors.mutedForeground }]}>
                  No products on this order
                </Text>
              )}
            </View>

            {isEditing ? (
              <View
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>
                  Notes
                </Text>
                <TextInput
                  style={[
                    styles.notesInput,
                    { borderColor: colors.border, color: colors.foreground },
                  ]}
                  placeholder="Order notes (optional)"
                  placeholderTextColor={colors.mutedForeground}
                  value={draftNotes}
                  onChangeText={setDraftNotes}
                  multiline
                  numberOfLines={3}
                />
              </View>
            ) : order.notes ? (
              <View
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>
                  Notes
                </Text>
                <Text style={[styles.notes, { color: colors.foreground }]}>{order.notes}</Text>
              </View>
            ) : null}

            {!isEditing && logPreset ? (
              <Pressable
                style={[styles.logBtn, { borderColor: colors.primary }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowLog(true);
                }}
              >
                <Feather name="plus-circle" size={16} color={colors.primary} />
                <Text style={[styles.logBtnText, { color: colors.primary }]}>
                  Log activity
                </Text>
              </Pressable>
            ) : null}

            {!isEditing && activities && activities.length > 0 ? (
              <View
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>
                  Activity ({activities.length})
                </Text>
                <View style={{ marginTop: 8, marginHorizontal: -14 }}>
                  {activities.map((act, idx) => (
                    <ActivityItem
                      key={act.id}
                      type={act.type}
                      subtype={act.subtype ?? null}
                      subject={act.subject}
                      notes={act.notes ?? null}
                      memberName={act.memberName ?? null}
                      createdAt={act.createdAt}
                      durationMinutes={act.durationMinutes ?? null}
                      billable={!!act.billable}
                      isLast={idx === activities.length - 1}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {isEditing ? (
              <Pressable
                style={[
                  styles.saveBtn,
                  { backgroundColor: colors.primary, opacity: isSaving ? 0.6 : 1 },
                ]}
                onPress={saveChanges}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Feather name="check" size={18} color="#fff" />
                    <Text style={styles.saveBtnText}>Save Changes</Text>
                  </>
                )}
              </Pressable>
            ) : null}
          </View>

          {!isEditing && customerId ? (
            <View style={{ marginTop: 4 }}>
              <Text
                style={[
                  styles.sectionHeading,
                  { color: colors.mutedForeground },
                ]}
              >
                Credits & Refunds
              </Text>
              <CustomerAdjustments
                customerId={customerId}
                workOrderId={orderId}
                canEdit={canEditOrders}
              />
            </View>
          ) : null}

          {!isEditing ? (
            <MediaGallery
              context={{ workOrderId: orderId }}
              title="Attachments"
              canDelete={isManager}
            />
          ) : null}
        </ScrollView>
      )}

      <Modal
        visible={pickerVisible}
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
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
            <Pressable onPress={() => setPickerVisible(false)} style={styles.backBtn}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.topTitle, { color: colors.foreground }]}>Add Products</Text>
          </View>

          <View style={styles.pickerWrap}>
            <View
              style={[
                styles.searchBar,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
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
              contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
              renderItem={({ item }) => {
                const inCart = draftItems.find((i) => i.productId === item.id);
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
                      <View style={styles.inCartBadge}>
                        <Feather name="check" size={14} color={colors.primary} />
                        <Text style={[styles.inCartText, { color: colors.primary }]}>
                          {inCart.quantity}
                        </Text>
                      </View>
                    ) : null}
                    <Pressable
                      style={[styles.addBtn, { backgroundColor: colors.primary }]}
                      onPress={() => addProduct(item)}
                    >
                      <Feather name="plus" size={16} color="#fff" />
                    </Pressable>
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

            <Pressable
              style={[styles.doneBtn, { backgroundColor: colors.primary, marginBottom: insets.bottom + 12 }]}
              onPress={() => setPickerVisible(false)}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <QuickLogSheet
        visible={showLog}
        onClose={() => setShowLog(false)}
        preset={logPreset}
        workOrderId={orderId}
        lockEntity
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  logBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    borderStyle: "dashed",
    paddingVertical: 11,
  },
  logBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: { padding: 4 },
  editBtn: { padding: 4 },
  topTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  section: { padding: 16, gap: 12 },
  card: { padding: 14, borderRadius: 10, borderWidth: 1, gap: 8 },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  customer: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  statusText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "capitalize",
  },
  meta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  marginBannerTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionHeading: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  cardLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  editLineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  lineName: { fontSize: 14, fontFamily: "Inter_400Regular" },
  comboMixTag: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  lineQty: { fontSize: 13, fontFamily: "Inter_400Regular" },
  linePrice: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    minWidth: 60,
    textAlign: "right",
  },
  removeBtn: { padding: 4 },
  addProductBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    borderStyle: "dashed",
    paddingVertical: 10,
    marginTop: 4,
  },
  addProductText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
    borderTopWidth: 1,
    marginTop: 4,
  },
  totalLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  totalValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
  },
  subtotalLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  subtotalValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  emptyLine: { fontSize: 14, fontFamily: "Inter_400Regular" },
  notes: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  notesInput: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 70,
    textAlignVertical: "top",
  },
  marginActions: { marginTop: 10, gap: 8 },
  marginBtnRow: { flexDirection: "row", gap: 8 },
  marginBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 8,
  },
  marginBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  pickerWrap: { flex: 1, padding: 16, gap: 12 },
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
  inCartBadge: { flexDirection: "row", alignItems: "center", gap: 3 },
  inCartText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  addBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  doneBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
  },
  doneBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
