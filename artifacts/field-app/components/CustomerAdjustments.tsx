import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useRouter } from "expo-router";

import {
  AdjustmentSourceOrder,
  CustomerAdjustment,
  getListCustomerAdjustmentsQueryKey,
  useCreateCustomerAdjustment,
  useDeleteCustomerAdjustment,
  useListCustomerAdjustments,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { ProductPicker, type PickedProduct } from "@/components/ProductPicker";
import { SourceOrderField } from "@/components/SourceOrderField";
import { useColors } from "@/hooks/useColors";

type AdjustmentType = "credit" | "return" | "refund";

const TYPE_META: Record<AdjustmentType, { label: string; short: string }> = {
  credit: { label: "Credit / Rebate / Discount", short: "Credit" },
  return: { label: "Product Return", short: "Return" },
  refund: { label: "Refund", short: "Refund" },
};

function getStatusMeta(status: string, colors: ReturnType<typeof useColors>) {
  switch (status.toLowerCase()) {
    case "draft": return { label: "Draft", bg: colors.muted, fg: colors.mutedForeground };
    case "posted": return { label: "Posted to QB", bg: colors.primary, fg: colors.primaryForeground };
    case "failed": return { label: "Post failed", bg: colors.destructive, fg: colors.destructiveForeground };
    case "void": return { label: "Void", bg: colors.muted, fg: colors.mutedForeground };
    default: return { label: status, bg: colors.muted, fg: colors.mutedForeground };
  }
}

type DraftLine = {
  productId: number | null;
  description: string;
  quantity: string;
  unitPrice: string;
  workOrderId: number | null;
  workOrderItemId: number | null;
  // Quantity sold on the linked source WO line, used to flag over-returns.
  sourceQuantity: number | null;
};

const emptyLine: DraftLine = {
  productId: null,
  description: "",
  quantity: "1",
  unitPrice: "",
  workOrderId: null,
  workOrderItemId: null,
  sourceQuantity: null,
};

function fmt(cents: number | null | undefined): string {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

interface Props {
  customerId: number;
  canEdit: boolean;
  /**
   * When set, the list is filtered to a single order and new adjustments are
   * pre-linked to that work order. Omit for the customer-wide view.
   */
  workOrderId?: number;
}

export function CustomerAdjustments({
  customerId,
  canEdit,
  workOrderId,
}: Props) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const router = useRouter();

  const orderScoped = !!workOrderId;
  const params = orderScoped ? { workOrderId } : { customerId };
  const { data: adjustments, isLoading } = useListCustomerAdjustments(params, {
    query: {
      queryKey: getListCustomerAdjustmentsQueryKey(params),
      enabled: orderScoped ? !!workOrderId : !!customerId,
    },
  });

  const createAdj = useCreateCustomerAdjustment();
  const deleteAdj = useDeleteCustomerAdjustment();

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AdjustmentType>("credit");
  const [reason, setReason] = useState("");
  const [memo, setMemo] = useState("");
  const [restockFee, setRestockFee] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...emptyLine }]);
  const [pickerLineIdx, setPickerLineIdx] = useState<number | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListCustomerAdjustmentsQueryKey(params),
    });

  const resetForm = () => {
    setType("credit");
    setReason("");
    setMemo("");
    setRestockFee("");
    setLines([{ ...emptyLine }]);
  };

  const subtotalCents = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const qty = parseFloat(l.quantity) || 0;
        const price = Math.round((parseFloat(l.unitPrice) || 0) * 100);
        return sum + Math.round(qty * price);
      }, 0),
    [lines],
  );
  const restockCents =
    type === "return" ? Math.round((parseFloat(restockFee) || 0) * 100) : 0;
  const netCents = Math.max(0, subtotalCents - restockCents);

  const updateLine = (idx: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, { ...emptyLine }]);
  const removeLine = (idx: number) =>
    setLines((prev) => prev.filter((_, i) => i !== idx));

  const handleProductSelect = (idx: number, product: PickedProduct) =>
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx
          ? {
              ...l,
              productId: product.id,
              description: product.name ?? l.description,
              unitPrice:
                product.price != null ? String(product.price) : l.unitPrice,
              // Changing the product invalidates any previously linked source
              // work order line — clear it so the picker re-suggests.
              workOrderId: null,
              workOrderItemId: null,
              sourceQuantity: null,
            }
          : l,
      ),
    );

  // Apply a selected source work order to a line: store the references and
  // pre-fill quantity and unit price from that WO line. Passing null clears it.
  const handleSourceSelect = (
    idx: number,
    order: AdjustmentSourceOrder | null,
  ) =>
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        if (!order) {
          return {
            ...l,
            workOrderId: null,
            workOrderItemId: null,
            sourceQuantity: null,
          };
        }
        return {
          ...l,
          workOrderId: order.workOrderId,
          workOrderItemId: order.workOrderItemId ?? null,
          sourceQuantity: order.quantity ?? null,
          quantity:
            order.quantity != null ? String(order.quantity) : l.quantity,
          unitPrice:
            order.unitPriceCents != null
              ? (order.unitPriceCents / 100).toFixed(2)
              : l.unitPrice,
        };
      }),
    );

  // Backfill the linked WO line's quantity (without touching the rep's entered
  // qty/price) so the over-return warning works after re-opening. Returns the
  // same array reference when unchanged to avoid a render loop.
  const handleSourceQuantityResolved = (idx: number, qty: number | null) =>
    setLines((prev) => {
      if (prev[idx]?.sourceQuantity === qty) return prev;
      return prev.map((l, i) =>
        i === idx ? { ...l, sourceQuantity: qty } : l,
      );
    });

  const canSubmit =
    lines.length > 0 &&
    lines.every(
      (l) =>
        (l.productId != null || l.description.trim()) &&
        parseFloat(l.quantity) > 0 &&
        l.unitPrice !== "",
    );

  const handleCreate = async () => {
    if (!canSubmit || createAdj.isPending) return;
    try {
      await createAdj.mutateAsync({
        data: {
          type,
          customerId,
          ...(orderScoped ? { workOrderId } : {}),
          reason: reason.trim() || null,
          memo: memo.trim() || null,
          restockFeeCents: type === "return" ? restockCents : null,
          items: lines.map((l) => ({
            productId: l.productId,
            description: l.description.trim() || null,
            quantity: parseFloat(l.quantity),
            unitPriceCents: Math.round((parseFloat(l.unitPrice) || 0) * 100),
            workOrderId: l.workOrderId,
            workOrderItemId: l.workOrderItemId,
          })),
        },
      });
      await invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOpen(false);
      resetForm();
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Couldn't record adjustment",
        err instanceof Error ? err.message : "Please try again.",
      );
    }
  };

  const confirmDelete = (adj: CustomerAdjustment) => {
    Alert.alert(
      "Delete adjustment?",
      "This draft will be permanently removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteAdj.mutateAsync({ id: adj.id });
              await invalidate();
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
            } catch (err) {
              Alert.alert(
                "Couldn't delete",
                err instanceof Error ? err.message : "Please try again.",
              );
            }
          },
        },
      ],
    );
  };

  const list = adjustments ?? [];

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 12 }}>
      {canEdit ? (
        <Pressable
          style={[styles.newBtn, { backgroundColor: colors.primary }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setOpen(true);
          }}
          testID="new-adjustment-btn"
        >
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={[styles.newBtnText, { color: colors.primaryForeground }]}>
            Record Credit / Return / Refund
          </Text>
        </Pressable>
      ) : null}

      {isLoading && list.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : list.length === 0 ? (
        <EmptyState
          icon="credit-card"
          title="No credits or refunds"
          subtitle={
            orderScoped
              ? "No credits, returns, or refunds recorded for this order."
              : "No credits, returns, or refunds recorded for this customer."
          }
        />
      ) : (
        list.map((a) => {
          const status = getStatusMeta(a.status, colors);
          const meta = TYPE_META[a.type as AdjustmentType];
          const isPosted = a.status === "posted";
          return (
            <View
              key={a.id}
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.titleRow}>
                    <Text
                      style={[styles.cardTitle, { color: colors.foreground }]}
                    >
                      {meta?.short ?? a.type}
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                      <Text style={[styles.statusText, { color: status.fg }]}>
                        {status.label}
                      </Text>
                    </View>
                  </View>
                  {a.workOrderNumber && !orderScoped ? (
                    <Text style={[styles.subtle, { color: colors.mutedForeground }]}>
                      Order {a.workOrderNumber}
                    </Text>
                  ) : null}
                  {a.reason ? (
                    <Text style={[styles.subtle, { color: colors.mutedForeground }]}>
                      {a.reason}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.amount, { color: colors.foreground }]}>
                    {fmt(a.amountCents)}
                  </Text>
                  {a.restockFeeCents > 0 ? (
                    <Text style={[styles.tiny, { color: colors.mutedForeground }]}>
                      incl. {fmt(a.restockFeeCents)} restock
                    </Text>
                  ) : null}
                </View>
              </View>

              {a.qbEntityId ? (
                <View style={styles.qbRow}>
                  <Feather name="check-circle" size={12} color={colors.primary} />
                  <Text style={[styles.tiny, { color: colors.primary }]}>
                    {a.qbEntityType} {a.qbDocNumber ?? a.qbEntityId}
                  </Text>
                </View>
              ) : null}
              {a.status === "failed" && a.qbSyncError ? (
                <View style={styles.qbRow}>
                  <Feather name="alert-circle" size={12} color={colors.destructive} />
                  <Text style={[styles.tiny, { color: colors.destructive, flex: 1 }]}>
                    {a.qbSyncError}
                  </Text>
                </View>
              ) : null}

              {a.items?.length ? (
                <View style={[styles.itemsBox, { borderTopColor: colors.border }]}>
                  {a.items.map((it) => (
                    <View key={it.id} style={styles.itemCol}>
                      <View style={styles.itemRow}>
                        <Text
                          style={[styles.itemName, { color: colors.mutedForeground }]}
                          numberOfLines={1}
                        >
                          {it.productName ?? it.description ?? "Item"} × {it.quantity}
                        </Text>
                        <Text style={[styles.itemAmount, { color: colors.mutedForeground }]}>
                          {fmt(it.amountCents)}
                        </Text>
                      </View>
                      {it.workOrderId ? (
                        <Pressable
                          style={styles.itemWoLink}
                          onPress={() => {
                            Haptics.impactAsync(
                              Haptics.ImpactFeedbackStyle.Light,
                            );
                            router.push(`/order/${it.workOrderId}`);
                          }}
                          hitSlop={6}
                        >
                          <Feather
                            name="external-link"
                            size={11}
                            color={colors.primary}
                          />
                          <Text
                            style={[styles.itemWoText, { color: colors.primary }]}
                          >
                            {it.workOrderNumber ?? `WO #${it.workOrderId}`}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}

              {canEdit && !isPosted ? (
                <Pressable
                  style={styles.deleteBtn}
                  onPress={() => confirmDelete(a)}
                  disabled={deleteAdj.isPending}
                  hitSlop={6}
                >
                  <Feather name="trash-2" size={13} color={colors.destructive} />
                  <Text style={[styles.deleteText, { color: colors.destructive }]}>
                    Delete
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}

      {/* Create modal */}
      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setOpen(false);
          resetForm();
        }}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: colors.background },
            ]}
          >
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                Record Adjustment
              </Text>
              <Pressable
                onPress={() => {
                  setOpen(false);
                  resetForm();
                }}
                hitSlop={8}
              >
                <Feather name="x" size={22} color={colors.foreground} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}
              keyboardShouldPersistTaps="handled"
            >
              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  Type
                </Text>
                <View style={styles.typeRow}>
                  {(Object.keys(TYPE_META) as AdjustmentType[]).map((t) => (
                    <Pressable
                      key={t}
                      style={[
                        styles.typeBtn,
                        {
                          borderColor: type === t ? colors.primary : colors.border,
                          backgroundColor:
                            type === t ? colors.accent : "transparent",
                        },
                      ]}
                      onPress={() => setType(t)}
                    >
                      <Text
                        style={[
                          styles.typeBtnText,
                          {
                            color:
                              type === t ? colors.primary : colors.mutedForeground,
                          },
                        ]}
                      >
                        {TYPE_META[t].short}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  Reason
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  placeholder="e.g. Damaged goods, Rebate"
                  placeholderTextColor={colors.mutedForeground}
                  value={reason}
                  onChangeText={setReason}
                />
              </View>

              <View style={{ gap: 10 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  Line items
                </Text>
                {lines.map((l, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.lineCard,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  >
                    <Pressable
                      style={[
                        styles.productBtn,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setPickerLineIdx(idx);
                      }}
                    >
                      <Feather
                        name="package"
                        size={15}
                        color={colors.mutedForeground}
                      />
                      <Text
                        style={[
                          styles.productBtnText,
                          {
                            color: l.productId
                              ? colors.foreground
                              : colors.mutedForeground,
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {l.productId ? l.description : "Select product (optional)"}
                      </Text>
                      {l.productId ? (
                        <Pressable
                          onPress={() =>
                            updateLine(idx, { productId: null })
                          }
                          hitSlop={8}
                        >
                          <Feather
                            name="x"
                            size={15}
                            color={colors.mutedForeground}
                          />
                        </Pressable>
                      ) : (
                        <Feather
                          name="chevron-right"
                          size={16}
                          color={colors.mutedForeground}
                        />
                      )}
                    </Pressable>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                          color: colors.foreground,
                        },
                      ]}
                      placeholder="Description *"
                      placeholderTextColor={colors.mutedForeground}
                      value={l.description}
                      onChangeText={(v) => updateLine(idx, { description: v })}
                    />
                    <View style={styles.lineInputsRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.tiny, { color: colors.mutedForeground }]}>
                          Qty
                        </Text>
                        <TextInput
                          style={[
                            styles.input,
                            {
                              backgroundColor: colors.background,
                              borderColor: colors.border,
                              color: colors.foreground,
                            },
                          ]}
                          placeholder="1"
                          placeholderTextColor={colors.mutedForeground}
                          value={l.quantity}
                          onChangeText={(v) => updateLine(idx, { quantity: v })}
                          keyboardType="decimal-pad"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.tiny, { color: colors.mutedForeground }]}>
                          Unit $
                        </Text>
                        <TextInput
                          style={[
                            styles.input,
                            {
                              backgroundColor: colors.background,
                              borderColor: colors.border,
                              color: colors.foreground,
                            },
                          ]}
                          placeholder="0.00"
                          placeholderTextColor={colors.mutedForeground}
                          value={l.unitPrice}
                          onChangeText={(v) => updateLine(idx, { unitPrice: v })}
                          keyboardType="decimal-pad"
                        />
                      </View>
                      {lines.length > 1 ? (
                        <Pressable
                          style={styles.lineRemoveBtn}
                          onPress={() => removeLine(idx)}
                          hitSlop={6}
                        >
                          <Feather
                            name="trash-2"
                            size={18}
                            color={colors.destructive}
                          />
                        </Pressable>
                      ) : null}
                    </View>
                    {(type === "return" || type === "credit") &&
                    l.productId != null ? (
                      <SourceOrderField
                        customerId={customerId}
                        productId={l.productId}
                        selectedWorkOrderId={l.workOrderId}
                        onSelect={(order) => handleSourceSelect(idx, order)}
                        onResolvedQuantity={(qty) =>
                          handleSourceQuantityResolved(idx, qty)
                        }
                      />
                    ) : null}
                    {l.workOrderId != null &&
                    l.sourceQuantity != null &&
                    parseFloat(l.quantity) > l.sourceQuantity ? (
                      <View style={styles.qtyWarnRow}>
                        <Feather
                          name="alert-triangle"
                          size={13}
                          color={colors.warning}
                        />
                        <Text style={[styles.qtyWarnText, { color: colors.warning }]}>
                          Qty {parseFloat(l.quantity)} exceeds the{" "}
                          {l.sourceQuantity} sold on the linked order. You can
                          still save this.
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ))}
                <Pressable
                  style={[styles.addLineBtn, { borderColor: colors.primary }]}
                  onPress={addLine}
                >
                  <Feather name="plus" size={15} color={colors.primary} />
                  <Text style={[styles.addLineText, { color: colors.primary }]}>
                    Add line
                  </Text>
                </Pressable>
              </View>

              {type === "return" ? (
                <View>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>
                    Restock fee ($)
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                    placeholder="0.00"
                    placeholderTextColor={colors.mutedForeground}
                    value={restockFee}
                    onChangeText={setRestockFee}
                    keyboardType="decimal-pad"
                  />
                </View>
              ) : null}

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  Memo (sent to QuickBooks)
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    styles.textarea,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  placeholder="Optional note"
                  placeholderTextColor={colors.mutedForeground}
                  value={memo}
                  onChangeText={setMemo}
                  multiline
                  numberOfLines={2}
                />
              </View>

              <View style={[styles.totalsBox, { backgroundColor: colors.muted }]}>
                <View style={styles.totalsRow}>
                  <Text style={[styles.tiny, { color: colors.mutedForeground }]}>
                    Subtotal
                  </Text>
                  <Text style={[styles.tiny, { color: colors.foreground }]}>
                    {fmt(subtotalCents)}
                  </Text>
                </View>
                {restockCents > 0 ? (
                  <View style={styles.totalsRow}>
                    <Text style={[styles.tiny, { color: colors.mutedForeground }]}>
                      − Restock fee
                    </Text>
                    <Text style={[styles.tiny, { color: colors.foreground }]}>
                      {fmt(restockCents)}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.totalsRow}>
                  <Text style={[styles.totalLabel, { color: colors.foreground }]}>
                    Net
                  </Text>
                  <Text style={[styles.totalValue, { color: colors.foreground }]}>
                    {fmt(netCents)}
                  </Text>
                </View>
              </View>

              <Pressable
                style={[
                  styles.submitBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: !canSubmit || createAdj.isPending ? 0.5 : 1,
                  },
                ]}
                onPress={handleCreate}
                disabled={!canSubmit || createAdj.isPending}
              >
                {createAdj.isPending ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text
                    style={[
                      styles.submitText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    Record
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ProductPicker
        visible={pickerLineIdx !== null}
        onClose={() => setPickerLineIdx(null)}
        onSelect={(product) => {
          if (pickerLineIdx !== null) handleProductSelect(pickerLineIdx, product);
          setPickerLineIdx(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 8,
  },
  newBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  productBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
  },
  productBtnText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  qtyWarnRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  qtyWarnText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  card: { borderWidth: 1, borderRadius: 10, padding: 14, gap: 8 },
  cardHeader: { flexDirection: "row", gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  statusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  subtle: { fontSize: 12, fontFamily: "Inter_400Regular" },
  amount: { fontSize: 16, fontFamily: "Inter_700Bold" },
  tiny: { fontSize: 11, fontFamily: "Inter_400Regular" },
  qbRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  itemsBox: { borderTopWidth: 1, paddingTop: 8, gap: 6 },
  itemCol: { gap: 2 },
  itemRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  itemName: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  itemAmount: { fontSize: 12, fontFamily: "Inter_500Medium" },
  itemWoLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
  },
  itemWoText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 2,
  },
  deleteText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: {
    maxHeight: "92%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  textarea: { minHeight: 60, textAlignVertical: "top" },
  typeRow: { flexDirection: "row", gap: 8 },
  typeBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: "center",
  },
  typeBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  lineCard: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 8 },
  lineInputsRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  lineRemoveBtn: { paddingBottom: 10, paddingHorizontal: 2 },
  addLineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
  },
  addLineText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  totalsBox: { borderRadius: 8, padding: 12, gap: 6 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  totalValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  submitBtn: {
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
  },
  submitText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
