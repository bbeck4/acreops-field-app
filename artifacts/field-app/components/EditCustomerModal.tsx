import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { Customer, CustomerPhone, getListMembersQueryKey, useListMembers, useUpdateCustomer } from "@workspace/api-client-react";

import { PhonesEditor } from "@/components/PhonesEditor";
import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

function initialPhones(c: { phones?: CustomerPhone[] | null; phone?: string | null }): CustomerPhone[] {
  if (c.phones && c.phones.length > 0) return c.phones;
  if (c.phone) return [{ label: "Main", value: c.phone }];
  return [];
}

type Props = {
  customer: Customer;
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

export function EditCustomerModal({ customer, visible, onClose, onSaved }: Props) {
  const colors = useColors();
  const { mutateAsync: updateCustomer, isPending } = useUpdateCustomer();
  const { currentMember } = useAppAuth();
  const role = (currentMember?.role ?? "").toLowerCase();
  const isManager = role === "manager" || role === "admin";
  const isAdmin = role === "admin";
  const { data: members } = useListMembers(undefined, { query: { queryKey: getListMembersQueryKey(), enabled: isManager } });

  const [name, setName] = useState(customer.name);
  const [email, setEmail] = useState(customer.email ?? "");
  const [phones, setPhones] = useState<CustomerPhone[]>(initialPhones(customer));
  const [address, setAddress] = useState(customer.address ?? "");
  const [city, setCity] = useState(customer.city ?? "");
  const [stateText, setStateText] = useState(customer.state ?? "");
  const [zip, setZip] = useState(customer.zip ?? "");
  const [territory, setTerritory] = useState(customer.territory ?? "");
  const [birthday, setBirthday] = useState(customer.birthday ?? "");
  const [repId, setRepId] = useState<number | null>(customer.repId ?? null);
  const [podEmailOptOut, setPodEmailOptOut] = useState<boolean>(!!customer.podEmailOptOut);
  const [inlineGeocodeError, setInlineGeocodeError] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(customer.name);
      setEmail(customer.email ?? "");
      setPhones(initialPhones(customer));
      setAddress(customer.address ?? "");
      setCity(customer.city ?? "");
      setStateText(customer.state ?? "");
      setZip(customer.zip ?? "");
      setTerritory(customer.territory ?? "");
      setBirthday(customer.birthday ?? "");
      setRepId(customer.repId ?? null);
      setPodEmailOptOut(!!customer.podEmailOptOut);
      setInlineGeocodeError(false);
    }
    // Only reset when the modal opens, not when the customer object
    // refetches while the modal is still visible (which would wipe the
    // inline geocode-failure warning the rep is reading).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const canSubmit = name.trim().length > 0 && !isPending;

  const submit = async () => {
    if (!canSubmit) return;
    setInlineGeocodeError(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const addressChanged =
      address !== (customer.address ?? "") ||
      city !== (customer.city ?? "") ||
      stateText !== (customer.state ?? "") ||
      zip !== (customer.zip ?? "");
    const wasGeocodeFailed = !!customer.geocodeFailed;

    try {
      const cleanedPhones = phones
        .map((p) => ({ label: p.label || "Main", value: p.value.trim() }))
        .filter((p) => p.value);
      const updated = await updateCustomer({
        id: customer.id,
        data: {
          name: name.trim(),
          email: email.trim() || undefined,
          phones: cleanedPhones,
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          state: stateText.trim() || undefined,
          zip: zip.trim() || undefined,
          territory: territory.trim() || undefined,
          birthday: birthday.trim() ? birthday.trim() : null,
          ...(isManager && repId != null ? { repId } : {}),
          ...(isAdmin ? { podEmailOptOut } : {}),
        },
      });

      const hasAddressInfo = !!(updated.address || updated.city || updated.state);
      const stillFailed = !!updated.geocodeFailed;
      const recovered = wasGeocodeFailed && addressChanged && !stillFailed && hasAddressInfo;

      if (addressChanged && stillFailed) {
        setInlineGeocodeError(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        onSaved?.();
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved?.();
      onClose();
      if (recovered) {
        Alert.alert("Customer saved", "Address located on the map.");
      }
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Failed to save", "Could not update customer. Please try again.");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose} style={styles.headerBtn} disabled={isPending}>
              <Text style={[styles.headerCancel, { color: colors.mutedForeground }]}>Cancel</Text>
            </Pressable>
            <Text style={[styles.title, { color: colors.foreground }]}>Edit Customer</Text>
            <Pressable
              onPress={submit}
              style={[
                styles.headerBtn,
                styles.saveBtn,
                { backgroundColor: colors.primary, opacity: canSubmit ? 1 : 0.4 },
              ]}
              disabled={!canSubmit}
              testID="edit-customer-save-btn"
            >
              {isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Save</Text>
              )}
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {inlineGeocodeError ? (
              <View
                style={[
                  styles.alert,
                  { backgroundColor: "#fef2f2", borderColor: "#fecaca" },
                ]}
                testID="edit-customer-geocode-error"
              >
                <Feather name="alert-triangle" size={16} color="#b91c1c" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertTitle}>Address couldn't be located</Text>
                  <Text style={styles.alertBody}>
                    We saved your changes, but couldn't find this address on the map. Double-check
                    it for typos, or set the location manually using the map pin.
                  </Text>
                </View>
              </View>
            ) : null}

            <Section label="BUSINESS" colors={colors}>
              <Field label="Name" value={name} onChangeText={setName} colors={colors} required />
            </Section>

            <Section label="PHONE" colors={colors}>
              <PhonesEditor phones={phones} onChange={setPhones} />
            </Section>

            <Section label="EMAIL" colors={colors}>
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                colors={colors}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="contact@farm.com"
              />
            </Section>

            <Section label="ADDRESS" colors={colors}>
              <Field
                label="Street"
                value={address}
                onChangeText={setAddress}
                colors={colors}
                placeholder="123 Farm Road"
                autoCapitalize="words"
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Field
                label="City"
                value={city}
                onChangeText={setCity}
                colors={colors}
                placeholder="Springfield"
                autoCapitalize="words"
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="State"
                    value={stateText}
                    onChangeText={setStateText}
                    colors={colors}
                    autoCapitalize="characters"
                    placeholder="IL"
                  />
                </View>
                <View style={[styles.vDivider, { backgroundColor: colors.border }]} />
                <View style={{ flex: 1 }}>
                  <Field
                    label="ZIP"
                    value={zip}
                    onChangeText={setZip}
                    colors={colors}
                    keyboardType="numeric"
                    placeholder="62701"
                  />
                </View>
              </View>
            </Section>

            <Section label="OTHER" colors={colors}>
              <Field
                label="Territory"
                value={territory}
                onChangeText={setTerritory}
                colors={colors}
                autoCapitalize="words"
                placeholder="Central"
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Field
                label="Birthday"
                value={birthday}
                onChangeText={setBirthday}
                colors={colors}
                autoCapitalize="none"
                placeholder="YYYY-MM-DD"
              />
            </Section>

            {isManager ? (
              <Section label="ASSIGNED REP" colors={colors}>
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
                        <Text
                          style={[
                            styles.chipText,
                            { color: selected ? "#fff" : colors.foreground },
                          ]}
                        >
                          {m.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {(members ?? []).length === 0 ? (
                    <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>
                      No team members found.
                    </Text>
                  ) : null}
                </View>
              </Section>
            ) : null}

            {isAdmin ? (
              <Section label="PROOF OF DELIVERY" colors={colors}>
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={[styles.toggleLabel, { color: colors.foreground }]}>
                      Auto-email PoD to customer
                    </Text>
                    <Text style={[styles.toggleHint, { color: colors.mutedForeground }]}>
                      When off, proof-of-delivery emails are not sent to this customer.
                    </Text>
                  </View>
                  <Switch value={!podEmailOptOut} onValueChange={(v) => setPodEmailOptOut(!v)} />
                </View>
              </Section>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Section({
  label,
  colors,
  children,
}: {
  label: string;
  colors: ReturnType<typeof useColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  colors,
  keyboardType,
  autoCapitalize,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  colors: ReturnType<typeof useColors>;
  keyboardType?: "default" | "phone-pad" | "email-address" | "numeric";
  autoCapitalize?: "none" | "words" | "sentences" | "characters";
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        {label}
        {required ? " *" : ""}
      </Text>
      <TextInput
        style={[styles.fieldInput, { color: colors.foreground }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    height: "92%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    borderBottomWidth: 1,
    gap: 12,
  },
  headerBtn: { paddingHorizontal: 8, paddingVertical: 6, minWidth: 60 },
  headerCancel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  title: { flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  saveBtn: {
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  content: { padding: 16, paddingBottom: 48 },
  section: { marginBottom: 18 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 6,
    marginLeft: 4,
  },
  fieldGroup: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  fieldLabel: { fontSize: 14, fontFamily: "Inter_500Medium", width: 90 },
  fieldInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  divider: { height: 1, marginLeft: 14 },
  row: { flexDirection: "row" },
  vDivider: { width: 1 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  emptyHint: { fontSize: 13, fontFamily: "Inter_400Regular" },
  toggleRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
  toggleLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  toggleHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 16 },
  alert: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    alignItems: "flex-start",
  },
  alertTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#b91c1c", marginBottom: 2 },
  alertBody: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#7f1d1d", lineHeight: 16 },
});
