import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetExpenseCategoriesQueryKey,
  useGetExpenseCategories,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/**
 * Category picker: a tap-to-open list of suggested + previously used categories
 * with an "+ Add new category…" escape hatch that swaps to a free-text input. A
 * newly typed category persists simply by being saved on a line — it reappears
 * in the list next time because the endpoint folds in distinct used categories.
 */
export function CategoryField({ value, onChange, placeholder = "Select a category" }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [draft, setDraft] = useState("");

  const { data } = useGetExpenseCategories({
    query: { queryKey: getGetExpenseCategoriesQueryKey() },
  });

  const options = useMemo(() => {
    const set = new Set<string>(data?.categories ?? []);
    if (value.trim()) set.add(value.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data, value]);

  const openPicker = () => {
    setCustomMode(false);
    setDraft("");
    setOpen(true);
  };

  const choose = (c: string) => {
    onChange(c);
    setOpen(false);
  };

  const commitCustom = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange(trimmed);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        style={[styles.field, { borderColor: colors.border, backgroundColor: colors.card }]}
        onPress={openPicker}
      >
        <Text
          style={[
            styles.fieldText,
            { color: value ? colors.foreground : colors.mutedForeground },
          ]}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[
              styles.sheet,
              { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                {customMode ? "New category" : "Category"}
              </Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {customMode ? (
              <View style={styles.customWrap}>
                <TextInput
                  autoFocus
                  style={[
                    styles.input,
                    { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
                  ]}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="New category name"
                  placeholderTextColor={colors.mutedForeground}
                  onSubmitEditing={commitCustom}
                  returnKeyType="done"
                />
                <View style={styles.customActions}>
                  <Pressable
                    style={[styles.outlineBtn, { borderColor: colors.border }]}
                    onPress={() => setCustomMode(false)}
                  >
                    <Feather name="chevron-left" size={16} color={colors.foreground} />
                    <Text style={[styles.outlineBtnText, { color: colors.foreground }]}>Back</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                    onPress={commitCustom}
                  >
                    <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                      Use category
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <FlatList
                data={options}
                keyExtractor={(c) => c}
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: 360 }}
                ListHeaderComponent={
                  <Pressable
                    style={[styles.row, styles.addRow, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      setDraft("");
                      setCustomMode(true);
                    }}
                  >
                    <Feather name="plus" size={16} color={colors.primary} />
                    <Text style={[styles.rowText, { color: colors.primary }]}>Add new category…</Text>
                  </Pressable>
                }
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                      No categories yet — add one.
                    </Text>
                  </View>
                }
                renderItem={({ item }) => {
                  const selected = item === value;
                  return (
                    <Pressable
                      style={[styles.row, { borderBottomColor: colors.border }]}
                      onPress={() => choose(item)}
                    >
                      <Text style={[styles.rowText, { color: colors.foreground }]} numberOfLines={1}>
                        {item}
                      </Text>
                      {selected ? (
                        <Feather name="check" size={16} color={colors.primary} />
                      ) : null}
                    </Pressable>
                  );
                }}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  fieldText: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", marginRight: 8 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  sheetTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 15,
    borderBottomWidth: 1,
    gap: 10,
  },
  addRow: { gap: 8, justifyContent: "flex-start" },
  rowText: { fontSize: 15, fontFamily: "Inter_500Medium", flexShrink: 1 },
  empty: { paddingVertical: 32, alignItems: "center" },
  customWrap: { paddingTop: 14, gap: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  customActions: { flexDirection: "row", gap: 10 },
  outlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  outlineBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  primaryBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingVertical: 12,
  },
  primaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
