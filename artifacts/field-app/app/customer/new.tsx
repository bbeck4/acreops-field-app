import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getListMembersQueryKey, useCreateCustomer, useListMembers, type CustomerPhone } from "@workspace/api-client-react";

import { PhonesEditor } from "@/components/PhonesEditor";
import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function NewCustomerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentMember } = useAppAuth();
  const role = (currentMember?.role ?? "").toLowerCase();
  const isManager = role === "manager" || role === "admin";
  const isAdmin = role === "admin";
  const { data: members } = useListMembers(undefined, { query: { queryKey: getListMembersQueryKey(), enabled: isManager } });

  const [name, setName] = useState("");
  const [phones, setPhones] = useState<CustomerPhone[]>([]);
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [territory, setTerritory] = useState("");
  const [birthday, setBirthday] = useState("");
  const [repId, setRepId] = useState<number | null>(currentMember?.id ?? null);
  const [podEmailOptOut, setPodEmailOptOut] = useState(false);
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { mutateAsync: createCustomer } = useCreateCustomer();

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  const canSubmit = name.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || isSaving) return;
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const cleanedPhones = phones
        .map((p) => ({ label: p.label || "Main", value: p.value.trim() }))
        .filter((p) => p.value);
      const newCustomer = await createCustomer({
        data: {
          name: name.trim(),
          phones: cleanedPhones,
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          state: state.trim() || undefined,
          territory: territory.trim() || undefined,
          notes: notes.trim() || undefined,
          birthday: birthday.trim() ? birthday.trim() : undefined,
          repId: repId ?? undefined,
          ...(isAdmin && podEmailOptOut ? { podEmailOptOut } : {}),
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/customer/${newCustomer.id}` as never);
    } catch {
      Alert.alert("Error", "Could not create customer. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Top bar */}
      <View
        style={[
          styles.topBar,
          { paddingTop: topPadding + 8, borderBottomColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>New Customer</Text>
        <Pressable
          style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: canSubmit && !isSaving ? 1 : 0.4 }]}
          onPress={submit}
          disabled={!canSubmit || isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Required */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>REQUIRED</Text>
          <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Field
              label="Business Name"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Green Acres Farm"
              colors={colors}
              autoCapitalize="words"
            />
          </View>
        </View>

        {/* Phone */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PHONE</Text>
          <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <PhonesEditor phones={phones} onChange={setPhones} />
          </View>
        </View>

        {/* Email */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>EMAIL</Text>
          <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="contact@farm.com" colors={colors} keyboardType="email-address" autoCapitalize="none" />
          </View>
        </View>

        {/* Location */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>LOCATION</Text>
          <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Field label="Street Address" value={address} onChangeText={setAddress} placeholder="123 Farm Road" colors={colors} autoCapitalize="words" />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Field label="City" value={city} onChangeText={setCity} placeholder="Springfield" colors={colors} autoCapitalize="words" />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Field label="State" value={state} onChangeText={setState} placeholder="IL" colors={colors} autoCapitalize="characters" />
              </View>
              <View style={[styles.vertDivider, { backgroundColor: colors.border }]} />
              <View style={{ flex: 1 }}>
                <Field label="Territory" value={territory} onChangeText={setTerritory} placeholder="Central" colors={colors} autoCapitalize="words" />
              </View>
            </View>
          </View>
        </View>

        {/* Details */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DETAILS</Text>
          <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Field label="Birthday" value={birthday} onChangeText={setBirthday} placeholder="YYYY-MM-DD" colors={colors} autoCapitalize="none" />
          </View>
        </View>

        {/* Assigned rep (managers/admins) */}
        {isManager ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ASSIGNED REP</Text>
            <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.chipWrap}>
                {(members ?? []).map((m) => {
                  const selected = repId === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setRepId(selected ? null : m.id)}
                      style={[
                        styles.chip,
                        {
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.primary : colors.background,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: selected ? "#fff" : colors.foreground }]}>
                        {m.name}
                      </Text>
                    </Pressable>
                  );
                })}
                {(members ?? []).length === 0 ? (
                  <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>No team members found.</Text>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        {/* Proof of delivery (admins) */}
        {isAdmin ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PROOF OF DELIVERY</Text>
            <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Auto-email PoD to customer</Text>
                  <Text style={[styles.toggleHint, { color: colors.mutedForeground }]}>
                    When off, proof-of-delivery emails are not sent to this customer.
                  </Text>
                </View>
                <Switch value={!podEmailOptOut} onValueChange={(v) => setPodEmailOptOut(!v)} />
              </View>
            </View>
          </View>
        ) : null}

        {/* Notes */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>NOTES</Text>
          <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              style={[styles.textarea, { color: colors.foreground }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional notes about this customer…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={4}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  colors,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  keyboardType?: "default" | "phone-pad" | "email-address" | "numeric";
  autoCapitalize?: "none" | "words" | "sentences" | "characters";
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { color: colors.foreground }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        returnKeyType="next"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: { padding: 4 },
  title: { flex: 1, fontSize: 18, fontFamily: "Inter_600SemiBold" },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 60,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  content: { padding: 16, gap: 0 },
  section: { marginBottom: 20 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 6,
    marginLeft: 4,
  },
  fieldGroup: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    width: 110,
  },
  fieldInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  divider: { height: 1, marginLeft: 14 },
  rowFields: { flexDirection: "row" },
  vertDivider: { width: 1 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  emptyHint: { fontSize: 13, fontFamily: "Inter_400Regular" },
  toggleRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
  toggleLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  toggleHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 16 },
  textarea: {
    padding: 14,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 90,
    textAlignVertical: "top",
  },
});
