import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { QuickLogSheet } from "@/components/QuickLogSheet";
import type { PickedEntity } from "@/components/EntityPicker";
import { useColors } from "@/hooks/useColors";

interface Props {
  /** Pre-selected entity, skips the picker when opening. */
  preset?: PickedEntity | null;
  /** Extra bottom offset, e.g. to clear a tab bar or banner. */
  bottomOffset?: number;
}

export function QuickLogFab({ preset = null, bottomOffset = 0 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const baseBottom = (Platform.OS === "web" ? 24 : insets.bottom + 12) + bottomOffset;

  return (
    <>
      <Pressable
        style={[styles.fab, { backgroundColor: colors.primary, bottom: baseBottom }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setOpen(true);
        }}
        testID="quick-log-fab"
      >
        <Feather name="edit-3" size={22} color="#fff" />
      </Pressable>
      <QuickLogSheet visible={open} onClose={() => setOpen(false)} preset={preset} />
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 50,
  },
});
