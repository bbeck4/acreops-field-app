import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useListMembers } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  selectedIds: number[];
  excludeMemberId?: number;
  singleSelect?: boolean;
  onClose: () => void;
  onApply: (ids: number[]) => void;
}

export function MemberPickerSheet({
  visible,
  selectedIds,
  excludeMemberId,
  singleSelect = false,
  onClose,
  onApply,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: members } = useListMembers();
  const [search, setSearch] = React.useState("");
  const [tempSelected, setTempSelected] = React.useState<Set<number>>(new Set(selectedIds));

  React.useEffect(() => {
    if (visible) {
      setTempSelected(new Set(selectedIds));
      setSearch("");
    }
  }, [visible, selectedIds]);

  const toggleMember = (id: number) => {
    if (singleSelect) {
      setTempSelected((selected) => selected.has(id) ? new Set() : new Set([id]));
      return;
    }
    const next = new Set(tempSelected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setTempSelected(next);
  };

  const filteredMembers = useMemo(() => {
    if (!members) return [];
    const term = search.trim().toLowerCase();
    return members.filter((m) =>
      m.id !== excludeMemberId &&
      (!term || m.name.toLowerCase().includes(term) || (m.role ?? "").toLowerCase().includes(term)),
    );
  }, [members, excludeMemberId, search]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>Share with</Text>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close member picker"
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {singleSelect
              ? "Choose one member, or clear the selection."
              : "Shared members can view and edit this item."}
          </Text>

          <View style={[styles.searchRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search members"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground }]}
              accessibilityLabel="Search members"
            />
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {filteredMembers.map((m) => {
              const selected = tempSelected.has(m.id);
              return (
                <Pressable
                  key={m.id}
                  style={[
                    styles.memberOption,
                    {
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primary + "11" : colors.background,
                    },
                  ]}
                  onPress={() => toggleMember(m.id)}
                  accessibilityRole={singleSelect ? "radio" : "checkbox"}
                  accessibilityLabel={`${m.name}, ${m.role || "Member"}`}
                  accessibilityState={singleSelect ? { selected } : { checked: selected }}
                >
                  <View>
                    <Text style={[styles.memberName, { color: colors.foreground }]}>
                      {m.name}
                    </Text>
                    <Text style={[styles.memberRole, { color: colors.mutedForeground }]}>
                      {m.role || "Member"}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.checkbox,
                      {
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primary : "transparent",
                      },
                    ]}
                  >
                    {selected && <Feather name="check" size={14} color="#fff" />}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Pressable
              style={[styles.applyBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                onApply(Array.from(tempSelected));
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel="Apply member selection"
            >
              <Text style={styles.applyText}>Apply Selection</Text>
            </Pressable>
          </View>
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
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    maxHeight: "80%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10 },
  subtitle: {
    paddingHorizontal: 20,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    marginBottom: 16,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  list: { flexShrink: 1 },
  listContent: { paddingHorizontal: 20, gap: 10, paddingBottom: 20 },
  memberOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    minHeight: 52,
    borderWidth: 1.5,
    borderRadius: 12,
  },
  memberName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  memberRole: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
  },
  applyBtn: {
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  applyText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
});
