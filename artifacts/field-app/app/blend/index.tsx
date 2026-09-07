import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function BlendChooserScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  const options = [
    {
      mode: "dry" as const,
      title: "Dry Blend",
      desc: "Mix dry fertilizer by the pound. See grade and lbs/ton.",
      icon: "grid" as const,
    },
    {
      mode: "liquid" as const,
      title: "Liquid Blend",
      desc: "Mix liquid products by the gallon. See lbs/gal nutrients.",
      icon: "droplet" as const,
    },
  ];

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
        <Text style={[styles.topTitle, { color: colors.foreground }]}>New Blend</Text>
        <View style={{ width: 30 }} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Build a custom blend, see the live analysis and margin, then save it or push it onto an order.
        </Text>
        {options.map((o) => (
          <Pressable
            key={o.mode}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push(o.mode === "dry" ? "/blend/dry" : "/blend/liquid")}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
              <Feather name={o.icon} size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{o.title}</Text>
              <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>{o.desc}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>
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
  body: { padding: 16, gap: 14 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 4 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  iconWrap: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  cardDesc: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 3 },
});
