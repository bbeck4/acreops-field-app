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
  getGetPickListQueryKey,
  useGetPickList,
  usePostPickList,
  useUpdatePickListLine,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { BarcodeScanner } from "@/components/BarcodeScanner";
import { useColors } from "@/hooks/useColors";
import {
  printOrShareHtml,
  renderPackingSlipHtml,
  renderPickListHtml,
} from "@/lib/printDocs";
import { locationsMatch, normalizeCode, parseScan } from "@/lib/scan";

export default function PickListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pickId = parseInt(id ?? "0", 10);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data: pick, isLoading, refetch } = useGetPickList(pickId);
  const updateLine = useUpdatePickListLine();
  const postPick = usePostPickList();

  const invalidate = () => qc.invalidateQueries({ queryKey: getGetPickListQueryKey(pickId) });

  if (isLoading || !pick) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Pick List" }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const allDone = pick.lines.every((l) => l.status === "picked" || l.status === "short");
  const isPosted = pick.status === "picked" || pick.status === "short";

  async function handlePost() {
    if (!allDone) {
      Alert.alert("Not ready", "Mark every line as picked or short first.");
      return;
    }
    try {
      await postPick.mutateAsync({ id: pickId });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Posted", "Pick list posted and inventory committed.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not post pick list";
      Alert.alert("Error", msg);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ title: pick.summary || "Pick List" }} />
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100, paddingTop: 12 }}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>{pick.summary}</Text>
          {pick.customerName ? (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              For {pick.customerName}
            </Text>
          ) : null}
          <View style={styles.statusRow}>
            <Text style={[styles.statusBadge, { color: colors.primary, borderColor: colors.primary }]}>
              {pick.status.toUpperCase()}
            </Text>
          </View>
          <View style={styles.shareRow}>
            <Pressable
              style={[styles.shareBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() =>
                printOrShareHtml(
                  renderPickListHtml(pick),
                  `Pick list ${pick.summary ?? pickId}`.trim(),
                )
              }
            >
              <Feather name="printer" size={14} color={colors.foreground} />
              <Text style={[styles.shareBtnText, { color: colors.foreground }]}>
                Share / Print pick list
              </Text>
            </Pressable>
            <Pressable
              style={[styles.shareBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() =>
                printOrShareHtml(
                  renderPackingSlipHtml(pick),
                  `Packing slip ${pick.summary ?? pickId}`.trim(),
                )
              }
            >
              <Feather name="package" size={14} color={colors.foreground} />
              <Text style={[styles.shareBtnText, { color: colors.foreground }]}>
                Share / Print packing slip
              </Text>
            </Pressable>
          </View>
        </View>

        {pick.lines.map((line) => (
          <PickLine
            key={line.id}
            line={line}
            disabled={isPosted}
            onUpdate={async (patch) => {
              await updateLine.mutateAsync({ id: pickId, lineId: line.id, data: patch });
              await invalidate();
              await refetch();
            }}
          />
        ))}
      </ScrollView>

      {!isPosted && (
        <View
          style={[
            styles.footer,
            { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 },
          ]}
        >
          <Pressable
            style={[
              styles.postBtn,
              { backgroundColor: allDone ? colors.primary : colors.muted },
            ]}
            onPress={handlePost}
            disabled={!allDone || postPick.isPending}
          >
            {postPick.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.postBtnText, { color: allDone ? "#fff" : colors.mutedForeground }]}>
                Post pick list
              </Text>
            )}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

interface LineProps {
  line: {
    id: number;
    productName: string;
    sku: string;
    unit?: string;
    qtyRequested: number;
    qtyPicked: number;
    status: string;
    onHand: number;
    lotTracked: boolean;
    binHint?: string | null;
    lotCode?: string | null;
    barcodes?: string[];
  };
  disabled: boolean;
  onUpdate: (patch: {
    qtyPicked?: number;
    status?: string;
    lotCode?: string | null;
    binHint?: string | null;
  }) => Promise<void>;
}

function PickLine({ line, disabled, onUpdate }: LineProps) {
  const colors = useColors();
  const [qty, setQty] = useState(String(line.qtyPicked));
  const [lot, setLot] = useState(line.lotCode ?? "");
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // Result of the latest bin scan against this line: confirmed, mismatch, or
  // newly recorded.
  const [binScan, setBinScan] = useState<
    { kind: "ok" | "mismatch" | "recorded"; code: string } | null
  >(null);

  useEffect(() => {
    setQty(String(line.qtyPicked));
    setLot(line.lotCode ?? "");
  }, [line.qtyPicked, line.lotCode]);

  const isShort = line.status === "short";
  const isPicked = line.status === "picked";
  const insufficientStock = line.onHand < line.qtyRequested;
  const skuNorm = normalizeCode(line.sku);
  const barcodeSet = new Set((line.barcodes ?? []).map(normalizeCode).filter(Boolean));

  async function handleScanned(code: string) {
    if (busy || disabled) return;
    // Location labels (LOC|…) confirm the picker pulled from the right bin.
    // Check this BEFORE the SKU/lot logic so a bin barcode is never mistaken
    // for a lot code.
    const parsed = parseScan(code);
    if (parsed.kind === "location") {
      if (!parsed.code) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert("Unrecognized location", "That location barcode was empty.");
        return;
      }
      if (line.binHint && !locationsMatch(parsed.code, line.binHint)) {
        setBinScan({ kind: "mismatch", code: parsed.code });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          "Wrong bin",
          `Expected ${line.binHint}, but scanned ${parsed.code}. Double-check before picking.`,
        );
        return;
      }
      // Matches the recorded bin, or no bin on file yet → record it.
      const recording = !line.binHint;
      setBinScan({ kind: recording ? "recorded" : "ok", code: parsed.code });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (recording) {
        setBusy(true);
        try {
          await onUpdate({ binHint: parsed.code });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Update failed";
          Alert.alert("Error", msg);
        } finally {
          setBusy(false);
        }
      }
      return;
    }
    const norm = normalizeCode(code);
    const matchesProduct = norm === skuNorm || barcodeSet.has(norm);
    if (matchesProduct) {
      const current = parseFloat(qty);
      const next = (Number.isFinite(current) ? current : 0) + 1;
      setQty(String(next));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBusy(true);
      try {
        await onUpdate({
          qtyPicked: next,
          status: next >= line.qtyRequested ? "picked" : "open",
          lotCode: line.lotTracked && lot ? lot : null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Update failed";
        Alert.alert("Error", msg);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (line.lotTracked) {
      setLot(code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBusy(true);
      try {
        await onUpdate({ lotCode: code });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Update failed";
        Alert.alert("Error", msg);
      } finally {
        setBusy(false);
      }
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const expected =
      barcodeSet.size > 0
        ? `SKU ${line.sku} or its UPC/EAN barcode`
        : `SKU ${line.sku}`;
    Alert.alert("No match", `Scanned code "${code}" doesn't match ${expected}.`);
  }

  async function commit(status: "picked" | "short") {
    if (busy || disabled) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const parsed = parseFloat(qty);
      const qtyPicked = Number.isFinite(parsed) ? parsed : 0;
      await onUpdate({
        qtyPicked,
        status,
        lotCode: line.lotTracked && lot ? lot : null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Update failed";
      Alert.alert("Error", msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={[
        styles.lineCard,
        {
          backgroundColor: colors.card,
          borderColor: isPicked ? colors.primary : isShort ? "#d62626" : colors.border,
        },
      ]}
    >
      <View style={styles.lineHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.lineName, { color: colors.foreground }]} numberOfLines={2}>
            {line.productName}
          </Text>
          <Text style={[styles.lineSku, { color: colors.mutedForeground }]}>{line.sku}</Text>
        </View>
        <View style={styles.lineQtyBox}>
          <Text style={[styles.lineQtyLabel, { color: colors.mutedForeground }]}>Need</Text>
          <Text style={[styles.lineQtyValue, { color: colors.foreground }]}>
            {line.qtyRequested} {line.unit ?? ""}
          </Text>
        </View>
      </View>

      {line.binHint ? (
        <Text style={[styles.binHint, { color: colors.mutedForeground }]}>
          <Feather name="map-pin" size={11} /> Bin {line.binHint}
        </Text>
      ) : null}
      {binScan ? (
        <Text
          style={[
            styles.binHint,
            { color: binScan.kind === "mismatch" ? "#d62626" : colors.primary },
          ]}
        >
          <Feather
            name={binScan.kind === "mismatch" ? "alert-triangle" : "check-circle"}
            size={11}
          />{" "}
          {binScan.kind === "mismatch"
            ? `Wrong bin: scanned ${binScan.code}`
            : binScan.kind === "recorded"
              ? `Bin recorded: ${binScan.code}`
              : `Bin confirmed: ${binScan.code}`}
        </Text>
      ) : null}
      <Text
        style={[
          styles.onHand,
          { color: insufficientStock ? "#d62626" : colors.mutedForeground },
        ]}
      >
        {line.onHand} on hand{insufficientStock ? " — short" : ""}
      </Text>

      <View style={styles.inputRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Picked qty</Text>
          <TextInput
            style={[
              styles.input,
              { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
            ]}
            value={qty}
            onChangeText={setQty}
            keyboardType="decimal-pad"
            editable={!disabled}
          />
        </View>
        {line.lotTracked ? (
          <View style={{ flex: 1 }}>
            <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Lot</Text>
            <TextInput
              style={[
                styles.input,
                { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
              ]}
              value={lot}
              onChangeText={setLot}
              autoCapitalize="characters"
              editable={!disabled}
            />
          </View>
        ) : null}
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.actionBtn, { backgroundColor: colors.muted }]}
          onPress={() => setScanOpen(true)}
          disabled={busy || disabled}
        >
          <Feather name="maximize" size={14} color={colors.foreground} />
          <Text style={[styles.actionText, { color: colors.foreground }]}>Scan</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, { backgroundColor: isPicked ? colors.primary : colors.muted }]}
          onPress={() => commit("picked")}
          disabled={busy || disabled}
        >
          <Feather name="check" size={14} color={isPicked ? "#fff" : colors.foreground} />
          <Text style={[styles.actionText, { color: isPicked ? "#fff" : colors.foreground }]}>
            Picked
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.actionBtn,
            { backgroundColor: isShort ? "#d62626" : colors.muted },
          ]}
          onPress={() => commit("short")}
          disabled={busy || disabled}
        >
          <Feather name="alert-triangle" size={14} color={isShort ? "#fff" : colors.foreground} />
          <Text style={[styles.actionText, { color: isShort ? "#fff" : colors.foreground }]}>
            Short
          </Text>
        </Pressable>
      </View>

      <BarcodeScanner
        visible={scanOpen}
        title={line.productName}
        hint={
          line.lotTracked
            ? `Scan SKU ${line.sku}${barcodeSet.size > 0 ? " or its UPC/EAN" : ""} to add 1, a lot code to set lot, or a LOC| label to confirm the bin.`
            : `Scan SKU ${line.sku}${barcodeSet.size > 0 ? " or its UPC/EAN" : ""} to add 1 unit, or a LOC| label to confirm the bin.`
        }
        onClose={() => setScanOpen(false)}
        onScanned={handleScanned}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 4 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  statusRow: { flexDirection: "row", marginTop: 6 },
  shareRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  shareBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  statusBadge: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  lineCard: {
    marginHorizontal: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  lineHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  lineName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  lineSku: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  lineQtyBox: { alignItems: "flex-end" },
  lineQtyLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase" },
  lineQtyValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  binHint: { fontSize: 12, fontFamily: "Inter_500Medium" },
  onHand: { fontSize: 12, fontFamily: "Inter_400Regular" },
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
  actionRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  actionText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    borderTopWidth: 1,
  },
  postBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  postBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
