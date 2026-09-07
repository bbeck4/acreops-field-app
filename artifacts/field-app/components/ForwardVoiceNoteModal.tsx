import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  useForwardProspectVoiceNote,
  useForwardVoiceNote,
  useListMembers,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  voiceNoteId: number | null;
  currentMemberId?: number;
  context?: "customer" | "prospect";
  onClose: () => void;
  onSuccess?: (count: number) => void;
}

export function ForwardVoiceNoteModal({
  visible,
  voiceNoteId,
  currentMemberId,
  context = "customer",
  onClose,
  onSuccess,
}: Props) {
  const colors = useColors();
  const { data: members } = useListMembers();
  const teammates = (members ?? []).filter((m) => m.id !== currentMemberId);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const forwardCustomer = useForwardVoiceNote();
  const forwardProspect = useForwardProspectVoiceNote();
  const { mutateAsync: forward, isPending } =
    context === "prospect" ? forwardProspect : forwardCustomer;

  useEffect(() => {
    if (!visible) {
      setSelected(new Set());
      setNote("");
    }
  }, [visible]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!voiceNoteId || selected.size === 0) return;
    try {
      const result = await forward({
        activityId: voiceNoteId,
        data: {
          recipientIds: Array.from(selected),
          note: note.trim() || undefined,
        },
      });
      onSuccess?.(result.forwarded ?? selected.size);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not forward voice note.";
      Alert.alert("Forward failed", msg);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>Forward voice note</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Send this voice note to one or more teammates. They&apos;ll see it in their Voice Inbox.
          </Text>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Recipients</Text>
          <ScrollView
            style={[styles.list, { borderColor: colors.border }]}
            keyboardShouldPersistTaps="handled"
          >
            {teammates.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                No other teammates yet.
              </Text>
            ) : (
              teammates.map((m) => {
                const checked = selected.has(m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => toggle(m.id)}
                    style={[styles.row, { borderBottomColor: colors.border }]}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        {
                          borderColor: checked ? colors.primary : colors.border,
                          backgroundColor: checked ? colors.primary : "transparent",
                        },
                      ]}
                    >
                      {checked ? <Feather name="check" size={12} color="#fff" /> : null}
                    </View>
                    <Text style={[styles.name, { color: colors.foreground }]}>{m.name}</Text>
                    <Text style={[styles.role, { color: colors.mutedForeground }]}>{m.role}</Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Note (optional)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Anything you want them to know…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={3}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
            ]}
          />

          <View style={styles.footer}>
            <Pressable onPress={onClose} style={[styles.btn, { borderColor: colors.border }]}>
              <Text style={[styles.btnText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={selected.size === 0 || isPending}
              style={[
                styles.btn,
                styles.btnPrimary,
                {
                  backgroundColor: colors.primary,
                  opacity: selected.size === 0 || isPending ? 0.5 : 1,
                },
              ]}
            >
              {isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[styles.btnText, { color: "#fff" }]}>
                  Forward{selected.size ? ` (${selected.size})` : ""}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 32,
    maxHeight: "85%",
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 16 },
  label: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", marginTop: 8, marginBottom: 6 },
  list: { borderWidth: 1, borderRadius: 8, maxHeight: 220 },
  empty: { padding: 12, fontSize: 13, fontFamily: "Inter_400Regular" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  role: { fontSize: 12, fontFamily: "Inter_400Regular" },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 70,
    textAlignVertical: "top",
  },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
    minWidth: 100,
    alignItems: "center",
  },
  btnPrimary: { borderWidth: 0 },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
