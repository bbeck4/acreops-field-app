import React from "react";
import { ScrollView, StyleSheet, View, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { getVisibleMoreTabLinks } from "@/lib/moreTabLinks";
import { usePermissions } from "@/lib/permissions";

export default function MoreTab() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { canSeeTab } = usePermissions();
  const links = getVisibleMoreTabLinks(canSeeTab);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>More</Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {links.map((link, index) => (
            <Pressable
              key={link.name}
              style={[
                styles.item,
                index < links.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
              ]}
              onPress={() => router.push(link.href as Href)}
              accessibilityRole="button"
              accessibilityLabel={`Go to ${link.label}`}
              accessibilityHint={`Opens ${link.label}`}
            >
              <View style={[styles.iconBox, { backgroundColor: colors.accent }]}>
                <Feather name={link.icon} size={20} color={colors.primary} />
              </View>
              <Text style={[styles.label, { color: colors.foreground }]}>{link.label}</Text>
              <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
            </Pressable>
          ))}
          {links.length === 0 && (
            <Text style={{ padding: 16, color: colors.mutedForeground, textAlign: "center", fontFamily: "Inter_400Regular" }}>
              No additional tabs available.
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  content: { padding: 16 },
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  item: { flexDirection: "row", alignItems: "center", padding: 16, gap: 16, minHeight: 64 },
  iconBox: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  label: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold" },
});