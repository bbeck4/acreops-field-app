import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export default function MapScreenImpl() {
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Feather name="map" size={48} color={colors.mutedForeground} />
      <Text style={[styles.title, { color: colors.foreground }]}>Map view</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        The interactive customer map is only available in the mobile app. Open the
        AcreOps Field App on your phone to view customer pins, territories, and routes.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  title: { fontSize: 20, fontWeight: "600" },
  body: { fontSize: 14, textAlign: "center", maxWidth: 360, lineHeight: 20 },
});
