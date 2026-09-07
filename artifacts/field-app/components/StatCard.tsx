import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type FeatherName = ComponentProps<typeof Feather>["name"];

interface Props {
  label: string;
  value: string | number;
  icon: FeatherName;
  accent?: boolean;
}

export function StatCard({ label, value, icon, accent }: Props) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: accent ? colors.primary : colors.card,
          borderColor: accent ? "transparent" : colors.border,
        },
      ]}
    >
      <View style={styles.topRow}>
        <Feather
          name={icon}
          size={18}
          color={accent ? "rgba(255,255,255,0.9)" : colors.primary}
        />
      </View>
      <View style={styles.content}>
        <Text style={[styles.value, { color: accent ? "#ffffff" : colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        <Text style={[styles.label, { color: accent ? "rgba(255,255,255,0.8)" : colors.mutedForeground }]}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 12,
    alignItems: "flex-start",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  content: { gap: 2, width: "100%" },
  value: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
});