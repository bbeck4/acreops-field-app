import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { useColors } from "@/hooks/useColors";

export type MapType = "standard" | "satellite" | "hybrid";

const ORDER: MapType[] = ["standard", "satellite", "hybrid"];
const LABEL: Record<MapType, string> = {
  standard: "Map",
  satellite: "Satellite",
  hybrid: "Hybrid",
};
const ICON: Record<MapType, React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  standard: "map-outline",
  satellite: "satellite-variant",
  hybrid: "layers-outline",
};

/** Cycle to the next map type: standard → satellite → hybrid → standard. */
export function nextMapType(current: MapType): MapType {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
}

/**
 * A compact pill that cycles the map base layer (standard / satellite / hybrid).
 * Tapping advances to the next layer; the label shows what you'll be looking at.
 */
export function MapTypeToggle({
  value,
  onChange,
  style,
}: {
  value: MapType;
  onChange: (next: MapType) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => onChange(nextMapType(value))}
      accessibilityRole="button"
      accessibilityLabel={`Map layer: ${LABEL[value]}. Tap to change.`}
      style={[styles.btn, { backgroundColor: colors.card, borderColor: colors.border }, style]}
    >
      <MaterialCommunityIcons name={ICON[value]} size={16} color={colors.primary} />
      <Text style={[styles.text, { color: colors.foreground }]}>{LABEL[value]}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  text: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
