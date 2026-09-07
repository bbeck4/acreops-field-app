import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { CustomerPhone } from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

const PHONE_LABELS = ["Mobile", "Home", "Work", "Main", "Home Fax", "Work Fax", "Other"] as const;

type Props = {
  phones: CustomerPhone[];
  onChange: (phones: CustomerPhone[]) => void;
};

export function PhonesEditor({ phones, onChange }: Props) {
  const colors = useColors();
  const [pickerForIndex, setPickerForIndex] = useState<number | null>(null);

  const updateAt = (i: number, patch: Partial<CustomerPhone>) =>
    onChange(phones.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const removeAt = (i: number) => onChange(phones.filter((_, idx) => idx !== i));
  const addRow = () => onChange([...phones, { label: nextLabel(phones), value: "" }]);

  return (
    <View>
      {phones.map((p, i) => (
        <View key={i}>
          {i > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
          <View style={styles.row}>
            <Pressable style={styles.deleteBtn} onPress={() => removeAt(i)} hitSlop={8}>
              <View style={[styles.minusCircle, { backgroundColor: colors.destructive }]}>
                <Feather name="minus" size={14} color={colors.destructiveForeground} />
              </View>
            </Pressable>
            <Pressable style={styles.labelBtn} onPress={() => setPickerForIndex(i)}>
              <Text style={[styles.labelText, { color: colors.primary }]}>{p.label || "Label"}</Text>
              <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
            </Pressable>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={p.value}
              onChangeText={(v) => updateAt(i, { value: v })}
              placeholder="Phone"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="phone-pad"
            />
          </View>
        </View>
      ))}
      {phones.length > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
      <Pressable style={styles.row} onPress={addRow}>
        <View style={styles.deleteBtn}>
          <View style={[styles.plusCircle, { backgroundColor: colors.primary }]}>
            <Feather name="plus" size={14} color={colors.primaryForeground} />
          </View>
        </View>
        <Text style={[styles.addText, { color: colors.foreground }]}>add phone</Text>
      </Pressable>

      <Modal
        visible={pickerForIndex != null}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerForIndex(null)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setPickerForIndex(null)}>
          <Pressable
            style={[styles.pickerSheet, { backgroundColor: colors.background }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.pickerTitle, { color: colors.mutedForeground }]}>Label</Text>
            <ScrollView>
              {PHONE_LABELS.map((l) => {
                const selected = pickerForIndex != null && phones[pickerForIndex]?.label === l;
                return (
                  <Pressable
                    key={l}
                    style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      if (pickerForIndex != null) updateAt(pickerForIndex, { label: l });
                      setPickerForIndex(null);
                    }}
                  >
                    <Text style={[styles.pickerLabel, { color: colors.foreground }]}>{l}</Text>
                    {selected ? <Feather name="check" size={18} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={[styles.pickerCancel, { borderTopColor: colors.border }]}
              onPress={() => setPickerForIndex(null)}
            >
              <Text style={[styles.pickerCancelText, { color: colors.primary }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function nextLabel(existing: CustomerPhone[]): string {
  const used = new Set(existing.map((p) => p.label));
  for (const l of PHONE_LABELS) {
    if (!used.has(l)) return l;
  }
  return "Other";
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  deleteBtn: { width: 22, alignItems: "center", justifyContent: "center" },
  minusCircle: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  plusCircle: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  labelBtn: { flexDirection: "row", alignItems: "center", gap: 2, minWidth: 80 },
  labelText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  divider: { height: 1, marginLeft: 46 },
  addText: { fontSize: 14, fontFamily: "Inter_400Regular" },

  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  pickerSheet: {
    maxHeight: "60%",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    overflow: "hidden",
    paddingTop: Platform.OS === "ios" ? 6 : 0,
  },
  pickerTitle: {
    fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  pickerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  pickerLabel: { fontSize: 16, fontFamily: "Inter_400Regular" },
  pickerCancel: { padding: 16, borderTopWidth: 1, alignItems: "center" },
  pickerCancelText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
