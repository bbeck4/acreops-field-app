import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

interface Option {
  value: string;
  label: string;
  dotColor: string;
}

interface Props {
  visible: boolean;
  title: string;
  itemTitle?: string;
  currentStatus?: string;
  options: Option[];
  onClose: () => void;
  onSelect: (value: string) => void;
}

export function StatusPickerModal({ visible, title, itemTitle, currentStatus, options, onClose, onSelect }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[styles.pickerSheet, { backgroundColor: colors.card }]}
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          <View style={[styles.sheetHandle, { backgroundColor: colors.muted }]} />
          <View style={styles.header}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
            <Pressable
              style={styles.closeBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          {itemTitle ? (
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 13,
                marginBottom: 8,
              }}
              numberOfLines={2}
            >
              {itemTitle}
            </Text>
          ) : null}
          {options.map((opt) => {
            const selected = currentStatus === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={[
                  styles.option,
                  {
                    borderColor: colors.border,
                    backgroundColor: selected ? colors.accent : "transparent",
                  },
                ]}
                onPress={() => onSelect(opt.value)}
                accessibilityRole="radio"
                accessibilityLabel={opt.label}
                accessibilityState={{ selected }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: opt.dotColor }} />
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}>
                    {opt.label}
                  </Text>
                </View>
                {selected ? <Feather name="check" size={16} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
          <View style={{ height: insets.bottom + 8 }} />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
    zIndex: 100,
  },
  pickerSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 10,
    maxHeight: "80%",
  },
  sheetHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    alignSelf: "center",
    marginBottom: 8,
  },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10 },
  option: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1.5,
  },
});
