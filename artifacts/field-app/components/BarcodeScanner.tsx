import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from "expo-camera";
import * as Haptics from "expo-haptics";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  title?: string;
  hint?: string;
  onClose: () => void;
  onScanned: (code: string, type: string) => void;
}

const BARCODE_TYPES: BarcodeType[] = [
  "qr",
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
  "code128",
  "code39",
  "code93",
  "codabar",
  "itf14",
  "pdf417",
  "datamatrix",
];

export function BarcodeScanner({ visible, title, hint, onClose, onScanned }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const lastScanRef = useRef<{ data: string; ts: number } | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);

  function handleScan(result: BarcodeScanningResult) {
    const data = result.data?.trim();
    if (!data) return;
    const now = Date.now();
    if (lastScanRef.current && lastScanRef.current.data === data && now - lastScanRef.current.ts < 1500) {
      return;
    }
    lastScanRef.current = { data, ts: now };
    setLastCode(data);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onScanned(data, result.type);
  }

  const isWeb = Platform.OS === "web";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.root, { backgroundColor: "#000" }]}>
        {isWeb ? (
          <View style={[styles.center, { padding: 24 }]}>
            <Feather name="camera-off" size={32} color="#fff" />
            <Text style={styles.unsupported}>
              Barcode scanning isn&apos;t supported in the web preview. Open this screen in the Expo
              Go app on a phone to scan.
            </Text>
          </View>
        ) : !permission ? (
          <View style={styles.center}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : !permission.granted ? (
          <View style={[styles.center, { padding: 24 }]}>
            <Feather name="camera" size={32} color="#fff" />
            <Text style={styles.permText}>
              Camera access is required to scan barcodes.
            </Text>
            <Pressable
              style={[styles.permBtn, { backgroundColor: colors.primary }]}
              onPress={requestPermission}
            >
              <Text style={styles.permBtnText}>Grant camera access</Text>
            </Pressable>
          </View>
        ) : (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
            onBarcodeScanned={handleScan}
          />
        )}

        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <View style={styles.topInner}>
            <View style={{ flex: 1 }}>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              {hint ? <Text style={styles.hint}>{hint}</Text> : null}
            </View>
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
              <Feather name="x" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>

        {!isWeb && permission?.granted ? (
          <View style={styles.reticleWrap} pointerEvents="none">
            <View style={styles.reticle} />
          </View>
        ) : null}

        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
          {lastCode ? (
            <Text style={styles.lastCode} numberOfLines={1}>
              Last: {lastCode}
            </Text>
          ) : null}
          <Pressable
            style={[styles.doneBtn, { backgroundColor: colors.primary }]}
            onPress={onClose}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  unsupported: { color: "#fff", fontFamily: "Inter_500Medium", fontSize: 14, textAlign: "center" },
  permText: { color: "#fff", fontFamily: "Inter_500Medium", fontSize: 15, textAlign: "center" },
  permBtn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  permBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  topInner: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  title: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
  hint: { color: "#e5e5e5", fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  reticleWrap: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  reticle: {
    width: 240,
    height: 160,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
    borderRadius: 14,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "rgba(0,0,0,0.45)",
    gap: 10,
  },
  lastCode: { color: "#fff", fontFamily: "Inter_500Medium", fontSize: 13, textAlign: "center" },
  doneBtn: { paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  doneBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
