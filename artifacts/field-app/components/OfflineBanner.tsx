import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

export function OfflineBanner() {
  const { isOnline, pendingCount, pendingWrites, syncingWriteIds, openTray } = useOffline();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  if (isOnline && pendingCount === 0) return null;

  const bg = isOnline ? colors.accent : "#422006";
  const fg = isOnline ? colors.primary : "#fbbf24";
  const failedCount = pendingWrites.filter((w) => w.failedReason).length;
  const statusText = isOnline
    ? failedCount > 0
      ? `${failedCount} write${failedCount !== 1 ? "s" : ""} failed or conflicted · tap to retry`
      : syncingWriteIds.length > 0
        ? `${syncingWriteIds.length} change${syncingWriteIds.length !== 1 ? "s" : ""} syncing...`
        : `${pendingCount} pending write${pendingCount !== 1 ? "s" : ""} · tap to review`
    : pendingCount > 0
      ? `${pendingCount} item${pendingCount !== 1 ? "s" : ""} saved offline · will sync when online`
      : "Working offline";

  return (
    <Pressable
      onPress={openTray}
      style={[
        styles.banner,
        { backgroundColor: bg },
        Platform.OS === "web" ? { paddingTop: insets.top + 67 } : { paddingTop: insets.top + 12 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${statusText}. Opens the sync queue.`}
      accessibilityLiveRegion="polite"
    >
      <Feather name={isOnline ? "upload-cloud" : "wifi-off"} size={16} color={fg} />
      <Text style={[styles.text, { color: fg }]}>
        {statusText}
      </Text>
      <View style={styles.chevronWrap}>
        <Feather name="chevron-right" size={16} color={fg} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)"
  },
  text: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1, textAlign: "center", letterSpacing: 0.2 },
  chevronWrap: { position: "absolute", right: 16, bottom: 12 },
});