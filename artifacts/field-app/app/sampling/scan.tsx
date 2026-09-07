import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useRef, useState } from "react";

import { BarcodeScanner } from "@/components/BarcodeScanner";

function normalizeCode(code: string) {
  return code.replace(/\s+/g, "").toUpperCase();
}

export default function SamplingScanScreen() {
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const [visible, setVisible] = useState(true);
  const handledRef = useRef(false);

  const close = useCallback(() => {
    setVisible(false);
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, []);

  const handleScanned = useCallback(
    (code: string) => {
      if (handledRef.current) return;
      const trimmed = normalizeCode(code);
      if (!trimmed) return;
      handledRef.current = true;
      setVisible(false);
      router.replace(`/sampling/collect?code=${encodeURIComponent(trimmed)}` as never);
    },
    [],
  );

  return (
    <BarcodeScanner
      visible={visible}
      title="Scan sample bag"
      hint="Point at the QR or barcode on the bag label"
      onClose={close}
      onScanned={handleScanned}
    />
  );
}
