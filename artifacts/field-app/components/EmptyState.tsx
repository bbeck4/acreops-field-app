import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type FeatherName = ComponentProps<typeof Feather>["name"];

interface Props {
  icon: FeatherName;
  title: string;
  subtitle?: string;
}

export function EmptyState({ icon, title, subtitle }: Props) {
  const colors = useColors();
  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: colors.accent, borderColor: colors.border }]}>
        <View style={[styles.iconInner, { backgroundColor: colors.card }]}>
          <Feather name={icon} size={32} color={colors.primary} />
        </View>
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 40,
    minHeight: 220,
  },
  iconWrap: {
    padding: 8,
    borderRadius: 40,
    borderWidth: 1,
    marginBottom: 8,
  },
  iconInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: -0.3 },
  subtitle: { fontSize: 15, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 22 },
});