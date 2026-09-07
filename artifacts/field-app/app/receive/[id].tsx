import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
  getGetReceiptQueryKey,
  usePostReceipt,
  useGetReceipt,
  useUpdateReceiptItems,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { BarcodeScanner } from "@/components/BarcodeScanner";
import { useColors } from "@/hooks/useColors";
import { normalizeCode, parseScan } from "@/lib/scan";

interface LineState {
  id: number;
  productId: number;
  productName: string;
  sku: string;
  unit?: string;
  quantity: string;
  lotCode: string;
  expiresAt: string;
  lotTracked: boolean;
  barcodes: string[];
  putawayLocation: string;
}

export default function ReceiveDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const receiptId = parseInt(id ?? "0", 10);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data: receipt, isLoading } = useGetReceipt(receiptId);
  const updateItems = useUpdateReceiptItems();
  const postReceipt = usePostReceipt();

  const [lines, setLines] = useState<LineState[]>([]);
  const [scanIdx, setScanIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!receipt) return;
    setLines(
      receipt.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        sku: it.sku,
        unit: it.unit,
        quantity: String(it.quantity ?? 0),
        lotCode: it.lotCode ?? "",
        expiresAt: it.expiresAt ?? "",
        lotTracked: it.lotTracked,
        barcodes: it.barcodes ?? [],
        putawayLocation: it.putawayLocation ?? "",
      })),
    );
  }, [receipt]);

  if (isLoading || !receipt) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Receive" }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const isPosted = receipt.status === "posted";

  function patchLine(idx: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function handleScanned(idx: number, code: string) {
    const line = lines[idx];
    if (!line) return;
    // Location labels (LOC|…) record where the goods were put away. Check this
    // BEFORE the SKU/lot logic so a bin barcode never gets mistaken for a lot.
    const parsed = parseScan(code);
    if (parsed.kind === "location") {
      if (!parsed.code) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert("Unrecognized location", "That location barcode was empty.");
        return;
      }
      patchLine(idx, { putawayLocation: parsed.code });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Put-away set", `${line.productName} → ${parsed.code}`);
      return;
    }
    const skuNorm = normalizeCode(line.sku);
    const barcodeSet = new Set(line.barcodes.map(normalizeCode).filter(Boolean));
    const norm = normalizeCode(code);
    if (norm === skuNorm || barcodeSet.has(norm)) {
      const current = parseFloat(line.quantity);
      const next = (Number.isFinite(current) ? current : 0) + 1;
      patchLine(idx, { quantity: String(next) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    if (line.lotTracked) {
      patchLine(idx, { lotCode: code });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const expected =
      barcodeSet.size > 0
        ? `SKU ${line.sku} or its UPC/EAN barcode`
        : `SKU ${line.sku}`;
    Alert.alert("No match", `Scanned code "${code}" doesn't match ${expected}.`);
  }

  async function saveAndPost() {
    try {
      const payload = {
        items: lines.map((l) => ({
          productId: l.productId,
          quantity: parseFloat(l.quantity) || 0,
          lotCode: l.lotTracked && l.lotCode ? l.lotCode : null,
          expiresAt: l.lotTracked && l.expiresAt ? l.expiresAt : null,
          putawayLocation: l.putawayLocation || null,
        })),
      };
      await updateItems.mutateAsync({ id: receiptId, data: payload });
      await postReceipt.mutateAsync({ id: receiptId });
      await qc.invalidateQueries({ queryKey: getGetReceiptQueryKey(receiptId) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Posted", "Receipt posted; inventory updated.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not post receipt";
      Alert.alert("Error", msg);
    }
  }

  const busy = updateItems.isPending || postReceipt.isPending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ title: receipt.receiptNumber || "Receive" }} />
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100, paddingTop: 12 }}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>{receipt.receiptNumber}</Text>
          {receipt.poNumber ? (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              PO {receipt.poNumber}
            </Text>
          ) : null}
          {receipt.siteName ? (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Into {receipt.siteName}
            </Text>
          ) : null}
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Status: {receipt.status}
          </Text>
        </View>

        {lines.map((line, idx) => (
          <View
            key={line.id}
            style={[styles.lineCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.lineHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.lineName, { color: colors.foreground }]} numberOfLines={2}>
                  {line.productName}
                </Text>
                <Text style={[styles.lineSku, { color: colors.mutedForeground }]}>{line.sku}</Text>
              </View>
              <Pressable
                style={[styles.scanBtn, { backgroundColor: colors.muted }]}
                onPress={() => setScanIdx(idx)}
                disabled={isPosted}
              >
                <Feather name="maximize" size={14} color={colors.foreground} />
                <Text style={[styles.scanBtnText, { color: colors.foreground }]}>Scan</Text>
              </Pressable>
            </View>

            <View style={styles.inputRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>
                  Qty received {line.unit ? `(${line.unit})` : ""}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                  value={line.quantity}
                  onChangeText={(v) => patchLine(idx, { quantity: v })}
                  keyboardType="decimal-pad"
                  editable={!isPosted}
                />
              </View>
            </View>

            {line.lotTracked ? (
              <View style={styles.inputRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Lot #</Text>
                  <TextInput
                    style={[
                      styles.input,
                      { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
                    ]}
                    value={line.lotCode}
                    onChangeText={(v) => patchLine(idx, { lotCode: v })}
                    autoCapitalize="characters"
                    editable={!isPosted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>
                    Expires (YYYY-MM-DD)
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
                    ]}
                    value={line.expiresAt}
                    onChangeText={(v) => patchLine(idx, { expiresAt: v })}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.mutedForeground}
                    editable={!isPosted}
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.inputRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>
                  Put-away location
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                  value={line.putawayLocation}
                  onChangeText={(v) => patchLine(idx, { putawayLocation: v })}
                  placeholder="Scan a LOC| label or type a bin"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="characters"
                  editable={!isPosted}
                />
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      <BarcodeScanner
        visible={scanIdx !== null}
        title={scanIdx !== null ? lines[scanIdx]?.productName : undefined}
        hint={
          scanIdx !== null && lines[scanIdx]
            ? lines[scanIdx].lotTracked
              ? `Scan SKU ${lines[scanIdx].sku}${(lines[scanIdx].barcodes ?? []).length > 0 ? " or its UPC/EAN" : ""} to add 1, a lot code to set lot, or a LOC| label to record put-away.`
              : `Scan SKU ${lines[scanIdx].sku}${(lines[scanIdx].barcodes ?? []).length > 0 ? " or its UPC/EAN" : ""} to add 1 unit, or a LOC| label to record put-away.`
            : undefined
        }
        onClose={() => setScanIdx(null)}
        onScanned={(code) => {
          if (scanIdx !== null) handleScanned(scanIdx, code);
        }}
      />

      {!isPosted && (
        <View
          style={[
            styles.footer,
            { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 },
          ]}
        >
          <Pressable
            style={[styles.postBtn, { backgroundColor: colors.primary }]}
            onPress={saveAndPost}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="check-circle" size={16} color="#fff" />
                <Text style={styles.postBtnText}>Save & Post Receipt</Text>
              </>
            )}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 4 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  lineCard: {
    marginHorizontal: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  lineHeaderRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  lineName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  lineSku: { fontSize: 12, fontFamily: "Inter_400Regular" },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  scanBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  inputRow: { flexDirection: "row", gap: 8 },
  inputLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 40,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    borderTopWidth: 1,
  },
  postBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
  },
  postBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
