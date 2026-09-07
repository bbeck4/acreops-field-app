import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useListProjects } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  selectedId: number | null;
  onClose: () => void;
  onSelect: (id: number | null) => void;
}

export function ProjectPickerSheet({ visible, selectedId, onClose, onSelect }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: projects, isLoading } = useListProjects();

  const activeProjects = useMemo(() => {
    return (projects || []).filter((p) => p.status !== "completed" && p.status !== "cancelled");
  }, [projects]);

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
            <Text style={[styles.title, { color: colors.foreground }]}>Select Project</Text>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close project picker"
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Pressable
              style={[
                styles.option,
                {
                  borderColor: selectedId === null ? colors.primary : colors.border,
                  backgroundColor: selectedId === null ? colors.primary + "11" : colors.background,
                },
              ]}
              onPress={() => {
                onSelect(null);
                onClose();
              }}
              accessibilityRole="radio"
              accessibilityLabel="No project"
              accessibilityState={{ selected: selectedId === null }}
            >
              <Text style={[styles.optionName, { color: colors.foreground }]}>
                No Project
              </Text>
              {selectedId === null && <Feather name="check" size={16} color={colors.primary} />}
            </Pressable>

            {isLoading ? (
              <View style={styles.messageRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.messageText, { color: colors.mutedForeground }]}>Loading projects…</Text>
              </View>
            ) : activeProjects.length === 0 ? (
              <Text style={[styles.messageText, { color: colors.mutedForeground }]}>
                No active projects are available.
              </Text>
            ) : activeProjects.map((p) => {
              const selected = selectedId === p.id;
              return (
                <Pressable
                  key={p.id}
                  style={[
                    styles.option,
                    {
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primary + "11" : colors.background,
                    },
                  ]}
                  onPress={() => {
                    onSelect(p.id);
                    onClose();
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={`${p.name}${p.ownerName ? `, owned by ${p.ownerName}` : ""}`}
                  accessibilityState={{ selected }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionName, { color: colors.foreground }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {p.ownerName ? (
                      <Text style={[styles.optionSubtitle, { color: colors.mutedForeground }]}>
                        Owned by {p.ownerName}
                      </Text>
                    ) : null}
                  </View>
                  {selected && <Feather name="check" size={16} color={colors.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>
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
    marginBottom: 16,
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10 },
  list: { flexShrink: 1 },
  listContent: { paddingHorizontal: 20, gap: 10 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    minHeight: 52,
    borderWidth: 1.5,
    borderRadius: 12,
  },
  optionName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  optionSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  messageRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8 },
  messageText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
});
