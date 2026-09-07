import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListCustomerFieldsQueryKey,
  useListCustomerFields,
  useListCustomers,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

export function CustomerPickerModal({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (id: number, name: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const { data: customers, isLoading } = useListCustomers({ search: search || undefined });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Select customer</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <View style={{ padding: 16 }}>
          <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search customers…"
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (customers ?? []).length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No customers found</Text>
          ) : (
            (customers ?? []).map((item) => (
              <Pressable
                key={item.id}
                style={[styles.modalRow, { borderBottomColor: colors.border }]}
                onPress={() => onSelect(item.id, item.name)}
              >
                <Text style={[styles.modalRowText, { color: colors.foreground }]}>{item.name}</Text>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function FieldPickerModal({
  visible,
  customerId,
  onClose,
  onSelect,
}: {
  visible: boolean;
  customerId: number | null;
  onClose: () => void;
  onSelect: (id: number, name: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: fields, isLoading } = useListCustomerFields(customerId ?? 0, {
    query: {
      queryKey: getListCustomerFieldsQueryKey(customerId ?? 0),
      enabled: visible && customerId != null,
    },
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Select field</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 8 }}>
          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (fields ?? []).length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No fields for this customer</Text>
          ) : (
            (fields ?? []).map((item) => (
              <Pressable
                key={item.id}
                style={[styles.modalRow, { borderBottomColor: colors.border }]}
                onPress={() => onSelect(item.id, item.name)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalRowText, { color: colors.foreground }]}>{item.name}</Text>
                  {item.acres ? (
                    <Text style={[styles.fieldMeta, { color: colors.mutedForeground }]}>{item.acres} acres</Text>
                  ) : null}
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15 },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalRowText: { fontSize: 15, fontWeight: "500" },
  fieldMeta: { fontSize: 12, marginTop: 2 },
  emptyText: { textAlign: "center", marginTop: 40, fontSize: 14 },
});
