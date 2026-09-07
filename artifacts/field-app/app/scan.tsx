import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";

import { listProducts } from "@workspace/api-client-react";

import { BarcodeScanner } from "@/components/BarcodeScanner";

function normalize(code: string) {
  return code.replace(/\s+/g, "").toUpperCase();
}

export default function GlobalScanScreen() {
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const lookingUpRef = useRef(false);

  const close = useCallback(() => {
    setVisible(false);
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, []);

  const handleScanned = useCallback(
    async (code: string) => {
      if (lookingUpRef.current || busy) return;
      const trimmed = code.trim();
      if (!trimmed) return;
      lookingUpRef.current = true;
      setBusy(true);
      try {
        const matches = await listProducts({ search: trimmed });
        const target = normalize(trimmed);
        const exact = matches.find((p) => normalize(p.sku) === target);
        if (!exact) {
          Alert.alert(
            "Product not found",
            `No product matches "${trimmed}". Check the SKU label and try again.`,
            [{ text: "OK", onPress: () => { lookingUpRef.current = false; } }],
          );
          return;
        }
        setVisible(false);
        if (params.returnTo) {
          router.replace(`${params.returnTo}?productId=${exact.id}` as never);
        } else {
          router.replace(`/product/${exact.id}` as never);
        }
      } catch {
        Alert.alert("Lookup failed", "Couldn't look up that code. Check your connection.", [
          { text: "OK", onPress: () => { lookingUpRef.current = false; } },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, params.returnTo],
  );

  return (
    <BarcodeScanner
      visible={visible}
      title="Find a product"
      hint={busy ? "Looking up product…" : "Point at any SKU label"}
      onClose={close}
      onScanned={handleScanned}
    />
  );
}
