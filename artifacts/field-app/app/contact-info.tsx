import { Feather } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetMemberQueryKey,
  useGetMember,
  useUpdateMember,
} from "@workspace/api-client-react";

import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

// The editable contact fields on the member record. Saves go through the
// shared PATCH /members/:id endpoint, which allows a member to edit their own
// contact info (empty string clears a field server-side).
const FIELDS = [
  { key: "phone", label: "Phone", placeholder: "(555) 123-4567", keyboard: "phone-pad" },
  { key: "addressStreet", label: "Street address", placeholder: "123 Main St" },
  { key: "addressCity", label: "City", placeholder: "Springfield" },
  { key: "addressState", label: "State", placeholder: "IL" },
  { key: "addressZip", label: "ZIP", placeholder: "62704", keyboard: "number-pad" },
  { key: "emergencyContactName", label: "Emergency contact name", placeholder: "Jane Doe" },
  {
    key: "emergencyContactPhone",
    label: "Emergency contact phone",
    placeholder: "(555) 987-6543",
    keyboard: "phone-pad",
  },
  {
    key: "contactNotes",
    label: "Notes",
    placeholder: "Anything else the office should know",
    multiline: true,
  },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
type Draft = Record<FieldKey, string>;

const EMPTY_DRAFT: Draft = {
  phone: "",
  addressStreet: "",
  addressCity: "",
  addressState: "",
  addressZip: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  contactNotes: "",
};

export default function ContactInfoScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { currentMember } = useAppAuth();
  const memberId = currentMember?.id ?? 0;

  const { data: member, isLoading } = useGetMember(memberId, {
    query: { enabled: memberId > 0, queryKey: getGetMemberQueryKey(memberId) },
  });
  const updateMember = useUpdateMember();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // Hydrate the form once the member record loads (and re-hydrate if the
  // record changes underneath us before the user starts typing).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!member || hydrated) return;
    setDraft({
      phone: member.phone ?? "",
      addressStreet: member.addressStreet ?? "",
      addressCity: member.addressCity ?? "",
      addressState: member.addressState ?? "",
      addressZip: member.addressZip ?? "",
      emergencyContactName: member.emergencyContactName ?? "",
      emergencyContactPhone: member.emergencyContactPhone ?? "",
      contactNotes: member.contactNotes ?? "",
    });
    setHydrated(true);
  }, [member, hydrated]);

  const save = async () => {
    if (!memberId) return;
    try {
      // Send every field: trimmed value, or empty string to clear it — this
      // matches the server contract (empty string clears a contact field).
      const data: Record<string, string> = {};
      for (const f of FIELDS) data[f.key] = draft[f.key].trim();
      await updateMember.mutateAsync({ id: memberId, data });
      queryClient.invalidateQueries({ queryKey: getGetMemberQueryKey(memberId) });
      Alert.alert("Saved", "Your contact info has been updated.");
      router.back();
    } catch {
      Alert.alert("Save failed", "Could not update your contact info. Please try again.");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: "My Contact Info" }} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="button-back">
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>My Contact Info</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading || !hydrated ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Keep your contact details current so the office can reach you. Leave a field blank to
              clear it.
            </Text>
            {FIELDS.map((f) => (
              <View key={f.key} style={styles.fieldBlock}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>{f.label}</Text>
                <TextInput
                  value={draft[f.key]}
                  onChangeText={(v) => setDraft((prev) => ({ ...prev, [f.key]: v }))}
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType={"keyboard" in f ? (f.keyboard as "phone-pad" | "number-pad") : "default"}
                  multiline={"multiline" in f && !!f.multiline}
                  style={[
                    styles.input,
                    "multiline" in f && f.multiline ? styles.inputMultiline : null,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  testID={`input-${f.key}`}
                />
              </View>
            ))}
            <Pressable
              onPress={save}
              disabled={updateMember.isPending}
              style={[
                styles.saveBtn,
                { backgroundColor: colors.primary, opacity: updateMember.isPending ? 0.6 : 1 },
              ]}
              testID="button-save-contact-info"
            >
              {updateMember.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveText}>Save</Text>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  hint: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 },
  fieldBlock: { marginBottom: 14 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  saveBtn: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
